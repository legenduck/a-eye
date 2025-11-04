import os
import time
import logging
import requests
import google.generativeai as genai
from flask import Flask, render_template, request, jsonify, Response, stream_with_context, session
from flask_cors import CORS
from PIL import Image
import io
from dotenv import load_dotenv
import math
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import torch
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont
from depth_anything_v2.dpt import DepthAnythingV2
import sys


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# --- 글로벌 상태 관리 ---
navigation_sessions = {}
latest_response = None  # 최신 응답 하나만 저장 (파이프라이닝)
response_lock = threading.Lock()  # 최신 응답 보호
tts_status = {"is_speaking": False, "current_text": ""}
current_image = None
image_lock = threading.Lock()
auto_processing = {"enabled": False, "thread": None}
stop_event = threading.Event()  # 스레드 중지 신호등
api_rotation = {"current_idx": 0}  # API 순환을 위한 인덱스
pending_requests = {}  # 대기 중인 요청들 추적

# --- Gemini API 키 3개 설정 ---
api_keys = []
for i in range(1, 4):  # API_KEY_1, API_KEY_2, API_KEY_3
    key = os.getenv(f"API_KEY_{i}")
    if key:
        api_keys.append(key)
        logger.info(f"API_KEY_{i} 로드됨")

if not api_keys:
    # 기존 단일 키도 체크
    single_key = os.getenv("API_KEY")
    if single_key:
        api_keys.append(single_key)
        logger.info("기본 API_KEY 로드됨")
    else:
        raise ValueError("최소 1개의 Gemini API 키가 필요합니다 (API_KEY_1, API_KEY_2, API_KEY_3 또는 API_KEY)")

logger.info(f"총 {len(api_keys)}개의 Gemini API 키 사용 가능")

# --- Naver API 설정 (기존 유지) ---
naver_client_id = os.getenv("NAVER_CLIENT_ID")
naver_client_secret = os.getenv("NAVER_CLIENT_SECRET")
if not naver_client_id or not naver_client_secret:
    logger.warning("Naver Search API keys (NAVER_CLIENT_ID, NAVER_CLIENT_SECRET) are not set. Place name conversion will be disabled.")

# --- NCP 설정 (기존 유지) ---
ncp_client_id = os.getenv("NCP_CLIENT_ID")
ncp_client_secret = os.getenv("NCP_CLIENT_SECRET")
if not ncp_client_id or not ncp_client_secret:
    logger.warning("Naver Cloud Platform API keys (NCP_CLIENT_ID, NCP_CLIENT_SECRET) are not set. Navigation feature will be disabled.")

SUPPORTED_MODELS = {
    'gemini-2.0-flash': {
        'type': 'gemini',
        'name': f'Gemini 2.0 Flash (병렬 {len(api_keys)}개)',
        'model_name': 'gemini-2.0-flash'
    },
    'gemini-1.5-flash': {
        'type': 'gemini',
        'name': f'Gemini 1.5 Flash (병렬 {len(api_keys)}개)',
        'model_name': 'gemini-1.5-flash'
    },
    'gemini-1.5-flash-8b': {
        'type': 'gemini',
        'name': f'Gemini 1.5 Flash 8B (병렬 {len(api_keys)}개)',
        'model_name': 'gemini-1.5-flash-8b'
    },
    'gemini-2.0-flash-lite': {
        'type': 'gemini',
        'name': f'Gemini 2.0 Flash Lite (병렬 {len(api_keys)}개)',
        'model_name': 'gemini-2.0-flash-lite'
    },
    'gemini-1.5-pro': {
        'type': 'gemini',
        'name': f'Gemini 1.5 Pro (병렬 {len(api_keys)}개)',
        'model_name': 'gemini-1.5-pro'
    }
}

# --- Gemini 모델 설정 ---
models = []
generation_config = {
  "temperature": 0.4,
  "top_p": 1,
  "top_k": 32,
  "max_output_tokens": 4096,
}
safety_settings = [
  {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
  {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
  {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
  {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
]

for key in api_keys:
    genai.configure(api_key=key)
    model = genai.GenerativeModel(
        model_name='gemini-2.0-flash',
        generation_config=generation_config,
        safety_settings=safety_settings
    )
    models.append(model)

def get_gemini_model(model_name, api_key):
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(
        model_name=model_name,
        generation_config=generation_config,
        safety_settings=safety_settings
    )

def analyze_image_single(image_pil, api_idx, model_name='gemini-2.0-flash'):
    prompt_parts = [
        """당신은 시각장애인의 안전한 보행을 돕는 전문 보조 AI입니다. 

다음 우선순위에 따라 정보를 제공하세요:

1. **즉시 위험 요소** (최우선):
   - 바로 앞 장애물(사람, 기둥, 공사구간, 차량 등)
   - 계단, 경사로, 움푹 패인 곳
   - 신호등 상태, 횡단보도 상황
   - 문이 열려있거나 닫혀있는 상태

2. **방향 및 이동 정보**:
   - 갈림길, 교차로 방향
   - 문 위치와 입구 정보
   - 엘리베이터, 에스컬레이터 위치

3. **중요한 텍스트 정보**:
   - 버스 번호, 지하철 노선
   - 상점명, 건물명
   - 중요한 표지판 내용 (화장실, 출구, 층수 등)

**제외할 정보**:
- 색상, 디자인, 장식적 요소
- 사람들의 옷차림이나 외모
- 세부적인 배경 묘사
- 용기 안의 내용물 등 불필요한 세부사항

**응답 형식**:
- 거리감 포함 ("2미터 앞", "바로 앞", "왼쪽에")
- 간결한 행동 지침 ("우회하세요", "직진 가능")
- 1-2문장, 핵심만 전달
- "사진에는", "이미지에는" 등의 불필요한 표현 금지

예시:
- "바로 앞 1미터에 기둥이 있어 왼쪽으로 우회하세요."
- "횡단보도 신호등이 빨간불입니다. 대기하세요."
- "왼쪽에 7번 버스 정류장이 있습니다."

지금 이미지를 분석해주세요:""",
        image_pil,
    ]
    
    try:
        start_time = time.time()
        api_key = api_keys[api_idx]
        model = get_gemini_model(model_name, api_key)
        response = model.generate_content(prompt_parts)
        end_time = time.time()
        
        processing_time = end_time - start_time
        logger.info(f"✅ API {api_idx}에서 {processing_time:.3f}초에 응답 완료")
        
        return {
            "description": response.text.strip(),
            "api_idx": api_idx,
            "processing_time": processing_time,
            "model_name": model_name,
            "success": True
        }
        
    except Exception as e:
        logger.error(f"❌ API {api_idx} 호출 실패: {e}")
        return {
            "description": "분석 중 오류가 발생했습니다.",
            "api_idx": api_idx,
            "processing_time": 0,
            "model_name": model_name,
            "success": False
        }

def process_api_response(request_id, api_idx, result):
    global latest_response
    
    if request_id in pending_requests:
        del pending_requests[request_id]
    
    if stop_event.is_set():
        logger.info(f"🗑️ API {api_idx} 응답 버림 - 시스템 중지됨 (요청 ID: {request_id[:8]})")
        return
    
    if tts_status["is_speaking"]:
        logger.info(f"🗑️ API {api_idx} 응답 버림 - TTS 진행 중 (요청 ID: {request_id[:8]})")
        return
    
    if not result["success"]:
        logger.warning(f"🗑️ API {api_idx} 응답 버림 - 호출 실패 (요청 ID: {request_id[:8]})")
        return
    
    with response_lock:
        latest_response = {
            "timestamp": time.time(),
            "description": result["description"],
            "api_idx": result["api_idx"],
            "processing_time": result["processing_time"],
            "model_name": result["model_name"],
            "request_id": request_id
        }
        logger.info(f"🔄 API {api_idx} 최신 응답으로 업데이트됨 (요청 ID: {request_id[:8]})")

def continuous_processing_worker():
    logger.info("🔄 자동 이미지 처리 워커 시작 (Event 기반)")
    
    while not stop_event.is_set():
        try:
            # 이미지가 없으면 0.1초 대기
            with image_lock:
                if current_image is None:
                    # stop_event.wait()를 사용하여 중지 신호를 즉시 감지
                    if stop_event.wait(timeout=0.1):  # 0.1초 대기 또는 중지 신호
                        break
                    continue
                # 안전한 이미지 복사
                image_array = np.array(current_image)
                image_copy = Image.fromarray(image_array)
            
            # 중지 신호 체크
            if stop_event.is_set():
                break
            
            # API 선택
            current_api_idx = api_rotation["current_idx"]
            api_rotation["current_idx"] = (current_api_idx + 1) % len(api_keys)
            
            # 요청 ID 생성
            request_id = f"req_{int(time.time() * 1000)}_{current_api_idx}"
            
            logger.info(f"🔍 API {current_api_idx}로 이미지 분석 시작 (요청 ID: {request_id[:8]})")
            
            # 요청 등록
            pending_requests[request_id] = {
                "api_idx": current_api_idx,
                "timestamp": time.time()
            }
            
            # API 호출 함수
            def api_call_worker():
                if stop_event.is_set():
                    logger.info(f"🛑 API {current_api_idx} 호출 취소됨")
                    if request_id in pending_requests:
                        del pending_requests[request_id]
                    return
                
                result = analyze_image_single(image_copy, current_api_idx)
                process_api_response(request_id, current_api_idx, result)
            
            # 중지 신호 다시 체크
            if stop_event.is_set():
                break
            
            # API 호출 시작
            api_thread = threading.Thread(target=api_call_worker, daemon=True)
            api_thread.start()
            
            # 1초 대기 (중지 신호 즉시 반응)
            if stop_event.wait(timeout=1.0):  # 1초 대기 또는 중지 신호
                logger.info("🛑 중지 신호 감지 - 워커 루프 종료")
                break
            
        except Exception as e:
            logger.error(f"자동 처리 워커 오류: {e}")
            # 오류 시에도 1초 대기하되 중지 신호 즉시 반응
            if stop_event.wait(timeout=1.0):
                break
    
    logger.info("🛑 자동 이미지 처리 워커 종료")

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # Earth's radius in meters
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    distance = R * c
    
    return distance

def convert_place_to_address(place_name):
    try:
        if not naver_client_id or not naver_client_secret:
            logger.warning("Naver Search API keys not configured. Using original place name.")
            return place_name
        
        # Naver Search API 호출
        search_url = "https://openapi.naver.com/v1/search/local.json"
        headers = {
            "X-Naver-Client-Id": naver_client_id,
            "X-Naver-Client-Secret": naver_client_secret
        }
        params = {
            "query": f"{place_name} 주소",
            "display": 5  # 검색 결과 수
        }
        
        logger.info(f"Searching for place: {place_name}")
        response = requests.get(search_url, headers=headers, params=params)
        response.raise_for_status()
        search_data = response.json()
        
        if not search_data.get('items'):
            logger.warning(f"No search results found for: {place_name}")
            return place_name
        
        # 첫 번째 검색 결과에서 주소 추출
        first_result = search_data['items'][0]
        address = first_result.get('address', '')
        road_address = first_result.get('roadAddress', '')
        
        # 도로명주소가 있으면 우선 사용, 없으면 지번주소 사용
        if road_address:
            logger.info(f"Found road address for '{place_name}': {road_address}")
            return road_address
        elif address:
            logger.info(f"Found address for '{place_name}': {address}")
            return address
        else:
            logger.warning(f"No address found in search results for: {place_name}")
            return place_name
            
    except Exception as e:
        logger.error(f"Error converting place to address: {e}")
        return place_name

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_models')
def get_models():
    models_list = []
    for model_id, config in SUPPORTED_MODELS.items():
        models_list.append({
            'id': model_id,
            'name': config['name']
        })
    return jsonify({"models": models_list})

@app.route('/upload_image', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({"error": "이미지 파일이 없습니다"}), 400
    
    image_file = request.files['image']
    
    try:
        image_pil = Image.open(image_file.stream)
        
        with image_lock:
            global current_image
            current_image = image_pil
        
        logger.info(f"📷 새 이미지 등록됨 - 크기: {image_pil.size}")
        
        return jsonify({
            "message": "이미지가 등록되었습니다. 자동 분석이 시작됩니다.",
            "image_size": image_pil.size
        })
        
    except Exception as e:
        logger.error(f"이미지 업로드 오류: {e}")
        return jsonify({"error": "이미지 처리 중 오류가 발생했습니다"}), 500

@app.route('/start_auto_processing', methods=['POST'])
def start_auto_processing():
    if auto_processing["enabled"]:
        return jsonify({"message": "자동 처리가 이미 실행 중입니다"})
    
    stop_event.clear()  # 중지 신호 해제 (초록불)
    auto_processing["enabled"] = True
    auto_processing["thread"] = threading.Thread(target=continuous_processing_worker, daemon=True)
    auto_processing["thread"].start()
    
    logger.info("🚀 자동 이미지 처리 시작됨")
    return jsonify({"message": "자동 이미지 처리가 시작되었습니다"})

@app.route('/stop_auto_processing', methods=['POST'])
def stop_auto_processing():
    global latest_response, current_image
    
    stop_event.set()
    auto_processing["enabled"] = False
    
    logger.info("🛑 중지 신호 전송됨")
    
    # 현재 이미지와 응답 클리어
    with image_lock:
        current_image = None
    
    with response_lock:
        latest_response = None
    
    # 대기 중인 요청들도 클리어
    pending_requests.clear()
    
    # 스레드가 정상 종료될 때까지 대기
    if auto_processing["thread"] and auto_processing["thread"].is_alive():
        logger.info("🔄 백그라운드 스레드 종료 대기 중...")
        # Event 방식이므로 빠르게 종료됨 (최대 2초)
        auto_processing["thread"].join(timeout=2.0)
        if auto_processing["thread"].is_alive():
            logger.warning("⚠️ 백그라운드 스레드가 2초 내 종료되지 않음")
        else:
            logger.info("✅ 백그라운드 스레드 정상 종료됨")
    
    auto_processing["thread"] = None
    
    logger.info("⏹️ 파이프라이닝 시스템 완전 중지됨 (Event 기반)")
    
    return jsonify({
        "message": "파이프라이닝 시스템이 완전히 중지되었습니다",
        "method": "threading.Event 기반 즉시 중지",
        "cleared": {
            "stop_event": True,
            "current_image": True,
            "latest_response": True,
            "pending_requests": True,
            "background_thread": True
        }
    })

@app.route('/get_response', methods=['GET'])
def get_response():
    global latest_response
    
    with response_lock:
        if latest_response is None:
            return jsonify({"message": "새로운 분석 결과가 없습니다"}), 204
        
        response = latest_response.copy()
        latest_response = None  # 사용 후 클리어
        
        logger.info(f"📬 최신 응답 반환: {response['description'][:50]}...")
        return jsonify(response)

@app.route('/set_tts_status', methods=['POST'])
def set_tts_status():
    data = request.get_json()
    is_speaking = data.get('is_speaking', False)
    current_text = data.get('current_text', '')
    
    tts_status["is_speaking"] = is_speaking
    tts_status["current_text"] = current_text
    
    status = "시작" if is_speaking else "완료"
    logger.info(f"🗣️ TTS 상태 업데이트: {status} - '{current_text[:30]}...'")
    
    return jsonify({"message": f"TTS 상태가 '{status}'로 업데이트되었습니다"})

@app.route('/get_tts_status', methods=['GET'])
def get_tts_status():
    return jsonify(tts_status)

@app.route('/get_queue_status', methods=['GET'])
def get_queue_status():
    with response_lock:
        has_response = latest_response is not None
        
    return jsonify({
        "has_latest_response": has_response,
        "auto_processing": auto_processing["enabled"],
        "tts_speaking": tts_status["is_speaking"],
        "available_apis": len(api_keys),
        "current_api_idx": api_rotation["current_idx"],
        "pending_requests": len(pending_requests),
        "pending_details": list(pending_requests.keys())
    })

# --- 기존 describe 엔드포인트 (호환성 유지하면서 병렬 처리 적용) ---
@app.route('/describe', methods=['POST'])
def describe():
    global latest_response, current_image  # 글로벌 변수 선언
    request_start = time.time()
    
    model_id = request.form.get('model', 'gemini-2.0-flash')
    logger.info(f"=== 이미지 업로드 및 파이프라이닝 시작 - 모델: {model_id} ===")
    
    if 'image' not in request.files:
        logger.warning("요청에 이미지 파일이 포함되지 않음")
        return jsonify({"error": "이미지 파일이 없습니다"}), 400

    if model_id not in SUPPORTED_MODELS:
        logger.warning(f"지원하지 않는 모델: {model_id}")
        return jsonify({"error": f"지원하지 않는 모델: {model_id}"}), 400

    file_receive_start = time.time()
    image_file = request.files['image']
    file_size = len(image_file.read())
    image_file.seek(0)  # Reset file pointer
    file_receive_time = time.time() - file_receive_start
    logger.info(f"이미지 파일 수신 완료 - 크기: {file_size} bytes, 시간: {file_receive_time:.3f}s")
    
    try:
        pil_start = time.time()
        image = Image.open(image_file.stream)
        pil_time = time.time() - pil_start
        logger.info(f"PIL 이미지 변환 완료 - 해상도: {image.size}, 시간: {pil_time:.3f}s")

        # 이미지를 글로벌 변수에 저장 (파이프라이닝용)
        # numpy 배열로 변환 후 새 PIL 이미지 생성하여 파일 스트림 의존성 완전 제거
        image_array = np.array(image)
        independent_image = Image.fromarray(image_array)
        
        with image_lock:
            current_image = independent_image
        
        # 자동 처리가 안 돌고 있으면 시작
        if not auto_processing["enabled"]:
            stop_event.clear()  # 중지 신호 해제 (초록불)
            auto_processing["enabled"] = True
            auto_processing["thread"] = threading.Thread(target=continuous_processing_worker, daemon=True)
            auto_processing["thread"].start()
            logger.info("🚀 파이프라이닝 자동 시작됨")
        
        # 기존 응답이 있으면 즉시 반환, 없으면 잠시 대기
        with response_lock:
            if latest_response is not None:
                response = latest_response.copy()
                latest_response = None
                logger.info(f"📬 기존 응답 즉시 반환: {response['description'][:50]}...")
                return jsonify({
                    "description": response["description"],
                    "model_name": f"Gemini 2.0 Flash (API {response['api_idx']}) - 파이프라이닝",
                    "processing_time": time.time() - request_start,
                    "pipelining": True
                })
        
        # 새 응답을 최대 3초 대기
        max_wait_time = 3.0
        wait_start = time.time()
        
        while (time.time() - wait_start) < max_wait_time:
            time.sleep(0.1)
            
            with response_lock:
                if latest_response is not None:
                    response = latest_response.copy()
                    latest_response = None
                    
                    total_time = time.time() - request_start
                    logger.info(f"📬 새 응답 반환 ({total_time:.3f}초 대기): {response['description'][:50]}...")
                    
                    return jsonify({
                        "description": response["description"],
                        "model_name": f"Gemini 2.0 Flash (API {response['api_idx']}) - 파이프라이닝",
                        "processing_time": total_time,
                        "pipelining": True
                    })
        
        # 3초 대기해도 응답이 없으면 타임아웃
        total_time = time.time() - request_start
        logger.warning(f"⏰ 파이프라이닝 응답 타임아웃 ({total_time:.3f}초)")
        
        return jsonify({
            "description": "분석 중입니다. 잠시 후 다시 시도해주세요.",
            "model_name": "Gemini 2.0 Flash - 파이프라이닝 (타임아웃)",
            "processing_time": total_time,
            "pipelining": True,
            "timeout": True
        })

    except Exception as e:
        error_time = time.time() - request_start
        logger.error(f"이미지 처리 중 오류 - 시간: {error_time:.3f}s, 오류: {str(e)}")
        return jsonify({"error": "처리 중 오류가 발생했습니다."}), 500

@app.route('/navigation_describe', methods=['POST'])
def navigation_describe():
    request_start = time.time()
    
    session_id = request.form.get('session_id')
    model_id = request.form.get('model', 'gemini-2.0-flash')
    current_location = request.form.get('location')  # "longitude,latitude"
    
    logger.info(f"=== Navigation describe request - session: {session_id}, model: {model_id}, location: {current_location} ===")
    
    if not session_id:
        return jsonify({"error": "Session ID is required"}), 400
    
    if session_id not in navigation_sessions:
        return jsonify({"error": "Navigation session not found"}), 404
    
    if 'image' not in request.files:
        return jsonify({"error": "Image file is missing"}), 400

    if model_id not in SUPPORTED_MODELS:
        return jsonify({"error": f"Unsupported model: {model_id}"}), 400

    nav_session = navigation_sessions[session_id]
    if not nav_session['active']:
        return jsonify({"error": "Navigation session is not active"}), 400

    model_config = SUPPORTED_MODELS[model_id]

    # 위치 업데이트 처리
    navigation_updated = False
    if current_location:
        try:
            current_coords = [float(x) for x in current_location.split(',')]
            current_lon, current_lat = current_coords
            
            nav_session['last_location'] = current_coords
            
            current_idx = nav_session['current_index']
            instructions = nav_session['instructions']
            waypoints = nav_session.get('waypoints', [])
            
            # 웨이포인트 기반 위치 업데이트
            if waypoints and current_idx < len(waypoints):
                target_waypoint = waypoints[current_idx]
                target_lon, target_lat = target_waypoint
                
                distance_to_waypoint = calculate_distance(current_lat, current_lon, target_lat, target_lon)
                logger.info(f"Distance to waypoint {current_idx}: {distance_to_waypoint:.1f}m")
                
                if distance_to_waypoint < 3:  # 3m 이내
                    nav_session['current_index'] = min(current_idx + 1, len(instructions) - 1)
                    navigation_updated = True
                    logger.info(f"Navigation updated to instruction {nav_session['current_index']}")
            
        except Exception as e:
            logger.error(f"Error updating location: {e}")

    # 현재 길안내 정보
    current_idx = nav_session['current_index']
    instructions = nav_session['instructions']
    navigation_info = {
        "current_instruction": instructions[current_idx] if current_idx < len(instructions) else None,
        "instruction_index": current_idx,
        "total_instructions": len(instructions),
        "goal_query": nav_session['goal_query'],
        "updated": navigation_updated
    }

    # 이미지 분석 시작
    file_receive_start = time.time()
    image_file = request.files['image']
    file_size = len(image_file.read())
    image_file.seek(0)
    file_receive_time = time.time() - file_receive_start
    logger.info(f"Image file received - size: {file_size} bytes, time: {file_receive_time:.3f}s")
    
    try:
        pil_start = time.time()
        image = Image.open(image_file.stream)
        pil_time = time.time() - pil_start
        logger.info(f"PIL image conversion completed - resolution: {image.size}, time: {pil_time:.3f}s")

        prompt_start = time.time()
        prompt = f"""당신은 시각장애인의 길안내를 위한 전문 보조 AI입니다.

**현재 길안내 상황**:
- 목적지: {navigation_info['goal_query']}
- 현재 안내사항: {navigation_info['current_instruction']}
- 진행상황: {navigation_info['instruction_index'] + 1}/{navigation_info['total_instructions']}

**우선순위에 따른 정보 제공**:

1. **길안내 관련 즉시 위험 요소** (최우선):
   - 안내 방향으로의 장애물 (사람, 기둥, 공사구간, 차량 등)
   - 계단, 경사로, 움푹 패인 곳
   - 신호등 상태, 횡단보도 상황
   - 안내 경로상의 문이나 출입구 상태

2. **길안내 방향 확인**:
   - 현재 안내사항과 실제 환경의 일치 여부
   - 갈림길, 교차로에서의 올바른 방향 선택
   - 건물 입구나 특정 지점 도달 확인

3. **안전한 이동을 위한 추가 정보**:
   - 버스 번호, 지하철 노선 (대중교통 이용시)
   - 상점명, 건물명 (위치 확인용)
   - 중요한 표지판 내용

**응답 형식**:
- 길안내 방향을 우선으로 한 구체적 지침
- 거리감과 방향 포함 ("2미터 앞", "오른쪽으로")
- 현재 안내사항 실행 가능 여부 명시
- 1-2문장으로 핵심만 전달

예시:
- "안내대로 직진하세요. 바로 앞 보행로가 깨끗합니다."
- "좌회전 지점입니다. 왼쪽에 횡단보도가 있어 신호 대기하세요."
- "목적지 건물 입구가 오른쪽 3미터 앞에 있습니다."

지금 이미지를 분석하여 길안내에 도움이 되는 정보를 제공해주세요:"""

        prompt_parts = [prompt, image]
        prompt_time = time.time() - prompt_start
        logger.info(f"Navigation prompt preparation completed - time: {prompt_time:.3f}s")

        api_start = time.time()
        logger.info(f"{model_config['name']} API call started for navigation...")
        model = get_gemini_model(model_config['model_name'], api_keys[0])
        response = model.generate_content(prompt_parts)
        api_time = time.time() - api_start
        logger.info(f"{model_config['name']} API response completed - time: {api_time:.3f}s")
        
        response_start = time.time()
        description = response.text.strip()
        response_time = time.time() - response_start
        logger.info(f"Response text processing completed - length: {len(description)} chars, time: {response_time:.3f}s")
        
        total_time = time.time() - request_start
        logger.info(f"=== Navigation describe completed - total time: {total_time:.3f}s ===")
        logger.info(f"Generated navigation description: {description}")
        
        return jsonify({
            "description": description,
            "navigation": navigation_info,
            "model_name": model_config['name'],
            "processing_time": total_time,
            "location_updated": bool(current_location)
        })

    except Exception as e:
        error_time = time.time() - request_start
        logger.error(f"Error during navigation describe - time: {error_time:.3f}s, error: {str(e)}")
        return jsonify({"error": "An error occurred during navigation image processing."}), 500

@app.route('/start_navigation', methods=['POST'])
def start_navigation():
    try:
        data = request.get_json()
        start = data.get('start')
        goal_query = data.get('goal')
        
        if not start or not goal_query:
            return jsonify({"error": "Start and goal parameters are required."}), 400
        
        logger.info(f"=== Starting new navigation session - Start: {start}, Goal: {goal_query} ===")
        
        # Get the full route first
        result = get_route_data(start, goal_query)
        if not result:
            return jsonify({"error": "Could not get route data"}), 404
        
        route_data = result.get_json()
        if 'error' in route_data:
            return route_data, 404
        
        session_id = str(uuid.uuid4())
        navigation_sessions[session_id] = {
            'instructions': route_data['guides'],
            'waypoints': route_data.get('waypoints', []),
            'current_index': 0,
            'start_coords': [float(x) for x in start.split(',')],
            'goal_query': goal_query,
            'active': True,
            'last_location': None
        }
        
        logger.info(f"Navigation session created with ID: {session_id}")
        logger.info(f"Route has {len(navigation_sessions[session_id]['instructions'])} instructions and {len(navigation_sessions[session_id]['waypoints'])} waypoints")
        
        return jsonify({
            "session_id": session_id,
            "total_instructions": len(route_data['guides']),
            "current_instruction": route_data['guides'][0] if route_data['guides'] else None,
            "message": "Navigation started. Please update your location to get instructions."
        })
        
    except Exception as e:
        logger.error(f"Error starting navigation: {e}")
        return jsonify({"error": "An error occurred while starting navigation."}), 500

@app.route('/update_location', methods=['POST'])
def update_location():
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        current_location = data.get('location')  # "longitude,latitude"
        
        if not session_id or not current_location:
            return jsonify({"error": "Session ID and current location are required."}), 400
        
        if session_id not in navigation_sessions:
            return jsonify({"error": "Navigation session not found."}), 404
        
        nav_session = navigation_sessions[session_id]
        
        if not nav_session['active']:
            return jsonify({"error": "Navigation session is not active."}), 400
        
        current_coords = [float(x) for x in current_location.split(',')]
        current_lon, current_lat = current_coords
        
        nav_session['last_location'] = current_coords
        
        current_idx = nav_session['current_index']
        instructions = nav_session['instructions']
        
        if current_idx >= len(instructions) - 1:
            return jsonify({
                "session_id": session_id,
                "current_instruction": instructions[current_idx] if current_idx < len(instructions) else None,
                "instruction_index": current_idx,
                "total_instructions": len(instructions),
                "status": "completed" if current_idx >= len(instructions) else "final_instruction",
                "message": "You have reached your destination!" if current_idx >= len(instructions) else "Approaching destination"
            })
        
        waypoints = nav_session.get('waypoints', [])
        if waypoints and current_idx < len(waypoints):
            # current target waypoint
            target_waypoint = waypoints[current_idx]
            target_lon, target_lat = target_waypoint
            
            # distance to target waypoint
            distance_to_waypoint = calculate_distance(current_lat, current_lon, target_lat, target_lon)
            logger.info(f"Distance to waypoint {current_idx}: {distance_to_waypoint:.1f}m (target: {target_lat:.6f}, {target_lon:.6f})")
            
            # if close enough to waypoint, advance to next instruction
            if distance_to_waypoint < 3:  # within 3m
                nav_session['current_index'] = min(current_idx + 1, len(instructions) - 1)
                logger.info(f"Advanced to instruction {nav_session['current_index']} - reached waypoint within {distance_to_waypoint:.1f}m")
        else:
            logger.warning(f"No waypoints available or index out of range. Current idx: {current_idx}, Waypoints: {len(waypoints)}")
        
        # update location
        nav_session['last_location'] = current_coords
        
        current_instruction = instructions[nav_session['current_index']]
        
        return jsonify({
            "session_id": session_id,
            "current_instruction": current_instruction,
            "instruction_index": nav_session['current_index'],
            "total_instructions": len(instructions),
            "status": "active",
            "message": "Location updated successfully"
        })
        
    except Exception as e:
        logger.error(f"Error updating location: {e}")
        return jsonify({"error": "An error occurred while updating location."}), 500

@app.route('/get_current_instruction', methods=['GET'])
def get_current_instruction():
    try:
        session_id = request.args.get('session_id')
        
        if not session_id:
            return jsonify({"error": "Session ID is required."}), 400
        
        if session_id not in navigation_sessions:
            return jsonify({"error": "Navigation session not found."}), 404
        
        nav_session = navigation_sessions[session_id]
        instructions = nav_session['instructions']
        current_idx = nav_session['current_index']
        
        return jsonify({
            "session_id": session_id,
            "current_instruction": instructions[current_idx] if current_idx < len(instructions) else None,
            "instruction_index": current_idx,
            "total_instructions": len(instructions),
            "status": "completed" if current_idx >= len(instructions) else "active"
        })
        
    except Exception as e:
        logger.error(f"Error getting current instruction: {e}")
        return jsonify({"error": "An error occurred while getting current instruction."}), 500

@app.route('/end_navigation', methods=['POST'])
def end_navigation():
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        
        if not session_id:
            return jsonify({"error": "Session ID is required."}), 400
        
        if session_id in navigation_sessions:
            navigation_sessions[session_id]['active'] = False
            logger.info(f"Navigation session {session_id} ended")
            return jsonify({"message": "Navigation session ended successfully"})
        else:
            return jsonify({"error": "Navigation session not found."}), 404
            
    except Exception as e:
        logger.error(f"Error ending navigation: {e}")
        return jsonify({"error": "An error occurred while ending navigation."}), 500



def try_ncp_v1_request(start, goal_query):
    try:
        goal_address_query = convert_place_to_address(goal_query)
        logger.info(f"Converted '{goal_query}' to address: '{goal_address_query}'")
        
        geocode_url = f"https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query={goal_address_query}"
        headers = {
            "x-ncp-apigw-api-key-id": ncp_client_id,
            "x-ncp-apigw-api-key": ncp_client_secret,
            "Accept": "application/json",
        }
        
        logger.info(f"Requesting geocoding with V1 API for '{goal_address_query}'...")
        response = requests.get(geocode_url, headers=headers)
        response.raise_for_status()
        geocode_data = response.json()

        if not geocode_data.get('addresses'):
            logger.warning(f"Geocoding failed for '{goal_address_query}'. No address found.")
            return jsonify({"error": f"Could not find location for '{goal_query}'."}), 404
        
        goal_address = geocode_data['addresses'][0]
        goal_coords = f"{goal_address['x']},{goal_address['y']}"
        logger.info(f"Geocoding successful for '{goal_address_query}': {goal_coords}")

        directions_url = f"https://maps.apigw.ntruss.com/map-direction/v1/driving?start={start}&goal={goal_coords}"
    
        logger.info(f"Requesting directions with V1 API from {start} to {goal_coords}...")
        response = requests.get(directions_url, headers=headers)
        response.raise_for_status()
        directions_data = response.json()

        if directions_data.get('code') != 0:
            logger.warning(f"Directions API returned error code {directions_data.get('code')}: {directions_data.get('message')}")
            return jsonify({"error": f"Could not find a route. Reason: {directions_data.get('message')}"}), 404

        route = directions_data['route']['traoptimal'][0]
        guides = route.get('guide', [])
        path = route.get('path', [])
        
        instructions = []
        waypoints = []
        
        for guide in guides:
            if guide.get('instructions'):
                instructions.append(guide['instructions'])
                
                # extract waypoint coordinates (using pointIndex)
                point_index = guide.get('pointIndex', 0)
                if point_index < len(path):
                    waypoint = path[point_index]
                    waypoints.append([waypoint[0], waypoint[1]])  # [longitude, latitude]
                else:
                    # if pointIndex is not available or out of range, use previous waypoint
                    waypoints.append(waypoints[-1] if waypoints else [0, 0])
        
        summary = route.get('summary', {})
        total_dist = summary.get('distance', 0) / 1000
        total_dura = summary.get('duration', 0) / 60000
        
        final_instruction = f"경로 안내를 종료합니다. 총 거리 {total_dist:.1f}킬로미터, 예상 소요 시간은 약 {total_dura:.0f}분입니다."
        instructions.append(final_instruction)
        
        # last waypoint is the destination coordinates
        goal_waypoint = [float(goal_coords.split(',')[0]), float(goal_coords.split(',')[1])]
        waypoints.append(goal_waypoint)
        
        logger.info(f"Directions found with V1 API. Returning {len(instructions)} instructions and {len(waypoints)} waypoints.")
        return jsonify({"guides": instructions, "waypoints": waypoints})

    except Exception as e:
        logger.error(f"V1 API request failed: {e}")
        return None

def get_route_data(start, goal_query):
    try:
        if not ncp_client_id or not ncp_client_secret:
            logger.error("Naver API keys are not configured.")
            return None

        logger.info("Using V1 API...")
        result = try_ncp_v1_request(start, goal_query)
        if result:
            return result
        
        logger.error("V1 API request failed.")
        return None

    except Exception as e:
        logger.error(f"An unexpected error occurred in get_route_data: {e}")
        return None

@app.route('/directions', methods=['GET'])
def get_directions():
    try:
        start = request.args.get('start')
        goal_query = request.args.get('goal')
        
        logger.info(f"=== New directions request started - Start: {start}, Goal: {goal_query} ===")

        result = get_route_data(start, goal_query)
        if result:
            return result
        else:
            return jsonify({"error": "Unable to get route data."}), 503

    except Exception as e:
        logger.error(f"An unexpected error occurred in /directions: {e}")
        return jsonify({"error": "An unexpected error occurred on the server."}), 500

@app.route('/logs')
def view_logs():
    try:
        with open('server.log', 'r', encoding='utf-8') as f:
            log_content = f.read()
        lines = log_content.split('\n')
        recent_lines = lines[-100:] if len(lines) > 100 else lines
        return '<pre style="background: #000; color: #0f0; padding: 20px; font-family: monospace;">' + '\n'.join(recent_lines) + '</pre>'
    except FileNotFoundError:
        return '<pre style="background: #000; color: #f00; padding: 20px;">Log file not found</pre>'

@app.route('/logs/clear')
def clear_logs():
    try:
        with open('server.log', 'w') as f:
            f.write('')
        logger.info("Log file cleared")
        return jsonify({"message": "Log file cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- 모델 및 디바이스 설정 ---
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
depth_model = None
try:
    MODEL_CONFIGS = {
        'small': {'encoder': 'vits', 'features': 64, 'out_channels': [48, 96, 192, 384]},
    }
    model_name = 'small'
    depth_model = DepthAnythingV2(**MODEL_CONFIGS[model_name])
    # 모델 가중치 파일 경로를 'a-eye' 디렉토리 기준으로 수정
    checkpoint_path = os.path.join(os.path.dirname(__file__), 'checkpoints', 'depth_anything_v2_metric_hypersim_vits.pth')
    depth_model.load_state_dict(torch.load(checkpoint_path, map_location=DEVICE))
    depth_model = depth_model.to(DEVICE).eval()
    logger.info(f"Depth Anything V2 '{model_name}' (Hypersim) model loaded on {DEVICE}")
except FileNotFoundError:
    logger.error(f"Checkpoint file not found. Make sure a valid checkpoint file exists in 'checkpoints/'.")
    depth_model = None # 모델 로드 실패 시 None으로 설정
except Exception as e:
    logger.error(f"Error loading depth model: {e}", exc_info=True)
    depth_model = None

def analyze_depth_for_obstacles(image_pil):
    """
    이미지에서 50cm 이내의 장애물을 감지합니다.
    calibrationFactor가 설정되어 있어야 합니다.
    """
    try:
        # 이미지를 OpenCV 형식으로 변환
        cv_image = np.array(image_pil)
        cv_image = cv_image[:, :, ::-1].copy()  # RGB -> BGR
        
        # 깊이 추정
        depth_map = depth_model.infer_image(cv_image)
        
        return depth_map
        
    except Exception as e:
        logger.error(f"깊이 분석 오류: {e}")
        return None

@app.route('/calibrate', methods=['POST'])
def calibrate():
    if DEVICE == 'cpu':
        return jsonify({"error": "GPU 환경에서만 사용이 가능합니다"}), 400
        
    if not depth_model:
        logger.error("Calibration failed because depth model is not loaded.")
        return jsonify({"error": "Depth model is not available."}), 500

    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    
    file = request.files['image']
    user_height_cm = float(request.form.get('height', 0))

    if not user_height_cm > 0:
        return jsonify({"error": "Invalid height provided"}), 400

    try:
        # 사용자 키(cm)를 기반으로 팔 길이(m) 추정
        # 팔 길이 = (키 * 0.26) / 100 (실제 측정 기반: 175cm → 45cm)
        estimated_arm_length_m = (user_height_cm * 0.26) / 100
        
        image_pil = Image.open(file.stream).convert("RGB")
        
        # 이미지를 OpenCV 형식으로 변환 (예제 코드와 동일하게)
        cv_image = np.array(image_pil)
        cv_image = cv_image[:, :, ::-1].copy()  # RGB -> BGR
        
        # infer_image 메소드 사용 (예제 코드 방식)
        depth_map = depth_model.infer_image(cv_image)
        
        # 화면 중앙점의 거리를 측정값으로 사용 (예제 코드와 동일)
        h, w = depth_map.shape
        measured_depth = depth_map[h//2, w//2].item()
        
        if measured_depth <= 0:
            return jsonify({"error": "Could not measure depth at the center. Please try again."}), 400
            
        # 보정 계수 계산 (실제거리 / 측정된 상대적 깊이)
        calibration_factor = estimated_arm_length_m / measured_depth
        
        logger.info(f"✅ 보정 완료: 키({user_height_cm}cm), 예상팔길이({estimated_arm_length_m:.3f}m), AI측정거리({measured_depth:.3f}), 보정계수({calibration_factor:.3f})")
        
        return jsonify({"calibrationFactor": calibration_factor})

    except Exception as e:
        logger.error(f"Calibration failed: {e}", exc_info=True)
        return jsonify({"error": "An error occurred during calibration."}), 500

@app.route('/analyze_depth', methods=['POST'])
def analyze_depth():
    """
    이미지의 깊이를 분석하고 50cm 이내 장애물을 감지합니다.
    """
    try:
        # 보정 계수 받기
        calibration_factor = float(request.form.get('calibrationFactor', 1.0))
        
        if 'image' not in request.files:
            return jsonify({"error": "이미지 파일이 없습니다"}), 400
            
        file = request.files['image']
        image_pil = Image.open(file.stream).convert("RGB")
        
        # 깊이 분석
        depth_map = analyze_depth_for_obstacles(image_pil)
        if depth_map is None:
            return jsonify({"error": "깊이 분석 실패"}), 500
            
        # 보정 계수 적용
        depth_map_calibrated = depth_map * calibration_factor
        
        # 50cm(0.5m) 이내 장애물 검사
        obstacle_threshold = 0.5  # 50cm
        close_obstacles = depth_map_calibrated < obstacle_threshold
        
        # 장애물이 있는 픽셀의 비율 계산
        total_pixels = depth_map_calibrated.size
        obstacle_pixels = np.sum(close_obstacles)
        obstacle_ratio = obstacle_pixels / total_pixels
        
        # 중앙 영역에서 가장 가까운 거리 확인
        h, w = depth_map_calibrated.shape
        center_h, center_w = h // 4, w // 4  # 중앙 1/4 영역
        center_region = depth_map_calibrated[center_h:3*center_h, center_w:3*center_w]
        min_distance = float(np.min(center_region))
        
        # 경고 조건: 중앙 영역에 50cm 이내 물체가 있거나, 전체 화면의 10% 이상이 장애물인 경우
        should_warn = min_distance < obstacle_threshold or obstacle_ratio > 0.1
        
        # 전체 화면의 최소 거리도 계산
        global_min_distance = float(np.min(depth_map_calibrated))
        
        if should_warn:
            logger.warning(f"🚨 장애물 감지! 중앙 최소거리: {min_distance:.2f}m, 전체 최소거리: {global_min_distance:.2f}m, 장애물비율: {obstacle_ratio:.1%}")
        else:
            logger.info(f"✅ 안전 - 중앙 최소거리: {min_distance:.2f}m, 전체 최소거리: {global_min_distance:.2f}m, 장애물비율: {obstacle_ratio:.1%}")
        
        return jsonify({
            "should_warn": bool(should_warn),
            "min_distance": round(float(min_distance), 2),
            "obstacle_ratio": round(float(obstacle_ratio), 3),
            "message": f"가장 가까운 물체: {min_distance:.2f}m" + (" - 경고!" if should_warn else "")
        })
        
    except Exception as e:
        logger.error(f"❌ 깊이 분석 중 오류 발생: {e}", exc_info=True)
        return jsonify({"error": "깊이 분석 중 서버에서 오류가 발생했습니다."}), 500


if __name__ == '__main__':
    # 디버그 모드 확인
    debug_mode = '--debug' in sys.argv
    # 기본 포트 8080, 다른 포트 사용 가능
    port = 8081 
    app.run(host='0.0.0.0', port=port, debug=debug_mode) 
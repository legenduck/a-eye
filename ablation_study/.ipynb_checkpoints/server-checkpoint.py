import os
import time
import logging
import google.generativeai as genai
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image
import io
from dotenv import load_dotenv
import glob
import json
import requests
import statistics
from datetime import datetime
import base64

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('ablation_server.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("GEMINI_API_KEY is not set")
genai.configure(api_key=api_key)

SUPPORTED_MODELS = {
    'gemini-1.5-flash-8b': {
        'type': 'gemini',
        'name': 'gemini-1.5-flash-8b',
        'model_name': 'gemini-1.5-flash-8b'
    },
    'gemini-2.0-flash-lite': {
        'type': 'gemini',
        'name': 'gemini-2.0-flash-lite',
        'model_name': 'gemini-2.0-flash-lite'
    },
    'gemini-2.5-flash-lite-preview-06-17': {
        'type': 'gemini',
        'name': 'Gemini 2.5 Flash lite',
        'model_name': 'gemini-2.5-flash-lite-preview-06-17'
    },
    'vllm-model': {
        'type': 'vllm',
        'name': 'vLLM Remote Model',
        'endpoint': os.getenv("VLLM_ENDPOINT", "http://localhost:8000/v1/chat/completions"),
        'model_name': os.getenv("VLLM_MODEL_NAME", "llava-v1.6-mistral-7b")
    }
}

performance_data = []

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

def format_time(time_ms):
    if time_ms < 1000:
        return f"{time_ms:.1f}ms"
    else:
        return f"{time_ms/1000:.2f}s"

def get_gemini_model(model_name):
    return genai.GenerativeModel(
        model_name=model_name,
        generation_config=generation_config,
        safety_settings=safety_settings
    )

def call_vllm_model(image, prompt, model_config):
    try:

        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        image_base64 = base64.b64encode(buffered.getvalue()).decode()
        
        payload = {
            "model": model_config['model_name'],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 4096,
            "temperature": 0.4
        }
        
        headers = {
            "Content-Type": "application/json"
        }
        
        response = requests.post(
            model_config['endpoint'],
            json=payload,
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            return result['choices'][0]['message']['content']
        else:
            raise Exception(f"vLLM API error: {response.status_code} - {response.text}")
            
    except Exception as e:
        logger.error(f"vLLM model call error: {str(e)}")
        raise e

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_models')
def get_models():
    models = []
    for model_id, config in SUPPORTED_MODELS.items():
        models.append({
            'id': model_id,
            'name': config['name'],
            'type': config['type']
        })
    return jsonify({"models": models})

@app.route('/get_image_list')
def get_image_list():
    try:
        image_dir = os.path.join(os.getcwd(), 'test_file')
        
        extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.gif']
        image_files = []
        
        for ext in extensions:
            image_files.extend(glob.glob(os.path.join(image_dir, ext)))
            image_files.extend(glob.glob(os.path.join(image_dir, ext.upper())))
        
        image_names = [os.path.basename(f) for f in image_files]
        image_names.sort()
        
        logger.info(f"Image file list: {len(image_names)} files found")
        return jsonify({"images": image_names})
        
    except Exception as e:
        logger.error(f"Image list retrieval error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/get_image/<filename>')
def get_image(filename):
    try:
        image_path = os.path.join(os.getcwd(), 'test_file', filename)
        
        if not os.path.exists(image_path):
            logger.warning(f"Image file not found: {filename}")
            return jsonify({"error": "File not found"}), 404
            
        logger.info(f"Image file provided: {filename}")
        return send_file(image_path)
        
    except Exception as e:
        logger.error(f"Image file provision error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/describe', methods=['POST'])
def describe():
    request_start = time.time()
    timestamp = datetime.now().isoformat()
    
    model_id = request.form.get('model', 'gemini-2.0-flash')
    image_name = request.form.get('image_name', 'unknown')
    
    logger.info(f"=== New image analysis request started - model: {model_id}, image: {image_name} ===")
    
    if 'image' not in request.files:
        logger.warning("Image file not included in request")
        return jsonify({"error": "Image file is missing"}), 400

    if model_id not in SUPPORTED_MODELS:
        logger.warning(f"Unsupported model: {model_id}")
        return jsonify({"error": "Unsupported model"}), 400

    model_config = SUPPORTED_MODELS[model_id]
    
    perf_data = {
        'timestamp': timestamp,
        'model_id': model_id,
        'model_name': model_config['name'],
        'image_name': image_name,
        'file_receive_time': 0,
        'pil_conversion_time': 0,
        'prompt_preparation_time': 0,
        'api_call_time': 0,
        'response_processing_time': 0,
        'total_time': 0,
        'success': False,
        'response_text': '',
        'error_message': None
    }

    # 1. Receive image file
    file_receive_start = time.time()
    image_file = request.files['image']
    file_size = len(image_file.read())
    image_file.seek(0)  # Reset file pointer
    perf_data['file_receive_time'] = (time.time() - file_receive_start) * 1000
    logger.info(f"Image file received - size: {file_size} bytes, time: {format_time(perf_data['file_receive_time'])}")
    
    try:
        # 2. PIL image conversion
        pil_start = time.time()
        image = Image.open(image_file.stream)
        perf_data['pil_conversion_time'] = (time.time() - pil_start) * 1000
        logger.info(f"PIL image conversion completed - resolution: {image.size}, time: {format_time(perf_data['pil_conversion_time'])}")

        # 3. Prompt preparation
        prompt_start = time.time()
        prompt_text = """당신은 시각장애인의 안전한 보행을 돕는 전문 보조 AI입니다. 

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

지금 이미지를 분석해주세요:"""
        
        perf_data['prompt_preparation_time'] = (time.time() - prompt_start) * 1000
        logger.info(f"Prompt preparation completed - time: {format_time(perf_data['prompt_preparation_time'])}")

        # 4. Model API call
        api_start = time.time()
        logger.info(f"{model_config['name']} API call started...")
        
        if model_config['type'] == 'gemini':
            model = get_gemini_model(model_config['model_name'])
            prompt_parts = [prompt_text, image]
            response = model.generate_content(prompt_parts)
            description = response.text.strip()
        elif model_config['type'] == 'vllm':
            description = call_vllm_model(image, prompt_text, model_config)
        else:
            raise ValueError(f"Unsupported model type: {model_config['type']}")
            
        perf_data['api_call_time'] = (time.time() - api_start) * 1000
        logger.info(f"{model_config['name']} API response completed - time: {format_time(perf_data['api_call_time'])}")
        
        # 5. Response processing
        response_start = time.time()
        perf_data['response_processing_time'] = (time.time() - response_start) * 1000
        perf_data['response_text'] = description
        perf_data['success'] = True
        
        logger.info(f"Response text processing completed - length: {len(description)} chars, time: {format_time(perf_data['response_processing_time'])}")
        
        perf_data['total_time'] = (time.time() - request_start) * 1000
        
        performance_data.append(perf_data)
        
        logger.info(f"=== Request processing completed - total time: {format_time(perf_data['total_time'])} ===")
        logger.info(f"Time analysis: file receive({format_time(perf_data['file_receive_time'])}) + PIL conversion({format_time(perf_data['pil_conversion_time'])}) + API call({format_time(perf_data['api_call_time'])}) + response processing({format_time(perf_data['response_processing_time'])})")
        logger.info(f"Generated description: {description}")
        
        return jsonify({
            "description": description,
            "performance": {
                "total_time": format_time(perf_data['total_time']),
                "api_call_time": format_time(perf_data['api_call_time']),
                "model_name": model_config['name']
            }
        })

    except Exception as e:
        error_time = (time.time() - request_start) * 1000
        perf_data['total_time'] = error_time
        perf_data['error_message'] = str(e)
        performance_data.append(perf_data)
        
        logger.error(f"Error during image processing - time: {format_time(error_time)}, error: {str(e)}")
        return jsonify({"error": "Error during image processing"}), 500

@app.route('/performance_report')
def performance_report():
    if not performance_data:
        return jsonify({"error": "Performance data is empty"}), 400
    
    try:
        model_stats = {}
        
        for data in performance_data:
            if not data['success']:
                continue
                
            model_id = data['model_id']
            if model_id not in model_stats:
                model_stats[model_id] = {
                    'model_name': data['model_name'],
                    'total_times': [],
                    'api_call_times': [],
                    'file_receive_times': [],
                    'pil_conversion_times': [],
                    'prompt_preparation_times': [],
                    'response_processing_times': [],
                    'count': 0,
                    'responses': []
                }
            
            stats = model_stats[model_id]
            stats['total_times'].append(data['total_time'])
            stats['api_call_times'].append(data['api_call_time'])
            stats['file_receive_times'].append(data['file_receive_time'])
            stats['pil_conversion_times'].append(data['pil_conversion_time'])
            stats['prompt_preparation_times'].append(data['prompt_preparation_time'])
            stats['response_processing_times'].append(data['response_processing_time'])
            stats['count'] += 1
            stats['responses'].append({
                'image': data['image_name'],
                'response': data['response_text'],
                'total_time': format_time(data['total_time'])
            })
        
        report = {}
        for model_id, stats in model_stats.items():
            if stats['count'] == 0:
                continue
                
            report[model_id] = {
                'model_name': stats['model_name'],
                'count': stats['count'],
                'average_times': {
                    'total': format_time(statistics.mean(stats['total_times'])),
                    'api_call': format_time(statistics.mean(stats['api_call_times'])),
                    'file_receive': format_time(statistics.mean(stats['file_receive_times'])),
                    'pil_conversion': format_time(statistics.mean(stats['pil_conversion_times'])),
                    'prompt_preparation': format_time(statistics.mean(stats['prompt_preparation_times'])),
                    'response_processing': format_time(statistics.mean(stats['response_processing_times']))
                },
                'responses': stats['responses']
            }
        
        logger.info(f"Performance report generated - {len(report)} models")
        return jsonify({"report": report, "total_tests": len(performance_data)})
        
    except Exception as e:
        logger.error(f"Performance report generation error: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/clear_performance_data', methods=['POST'])
def clear_performance_data():
    global performance_data
    performance_data = []
    logger.info("Performance data cleared")
    return jsonify({"message": "Performance data cleared"})

@app.route('/logs')
def view_logs():
    try:
        with open('ablation_server.log', 'r', encoding='utf-8') as f:
            log_content = f.read()
        lines = log_content.split('\n')
        recent_lines = lines[-100:] if len(lines) > 100 else lines
        return '<pre style="background: #000; color: #0f0; padding: 20px; font-family: monospace;">' + '\n'.join(recent_lines) + '</pre>'
    except FileNotFoundError:
        return '<pre style="background: #000; color: #f00; padding: 20px;">Log file not found</pre>'

@app.route('/logs/clear')
def clear_logs():
    try:
        with open('ablation_server.log', 'w') as f:
            f.write('')
        logger.info("Log file cleared")
        return jsonify({"message": "Log file cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    test_dir = os.path.join(os.getcwd(), 'test_file')
    if not os.path.exists(test_dir):
        os.makedirs(test_dir)
        logger.info(f"test_file folder created: {test_dir}")
    
    logger.info("Ablation Study server started - host: 0.0.0.0, port: 8081")
    logger.info(f"Supported models: {', '.join([config['name'] for config in SUPPORTED_MODELS.values()])}")
    app.run(host='0.0.0.0', port=8081) 
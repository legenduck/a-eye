<div align="center">

<img src="assets/poster.png" alt="A-EYE figura principal" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**Deogyong Kim · Junhyeong Park · Jun Seong Lee**

Gran Premio (Premio del Director del IITP) — Concurso Digital Universitario Centrado en SW 2025  
1.er Premio — SK AI Summit *AI's Got Talent* (Nov. 2025)

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## Resumen

Servicio web de asistencia visual en tiempo real para personas con discapacidad visual, que explora si los modelos de lenguaje grandes pueden actuar como un ayudante eficaz para ciegos. La cámara del teléfono transmite escenas a un backend Flask que combina Google Gemini (razonamiento visión-lenguaje), Depth Anything V2 (profundidad métrica para aviso de proximidad) y Naver Cloud Maps (navegación turn-by-turn) para entregar guía hablada concisa sobre lo que hay delante.

## Qué hace

- **Narración de escena.** Captura fotogramas de la cámara, los envía a Gemini con un prompt afinado para la seguridad peatonal (peligros, señalética, transporte) y reproduce la respuesta mediante el TTS del navegador.
- **Inferencia en pipeline.** Hasta tres claves de la API de Gemini se rotan en paralelo, así suele haber una nueva descripción lista para cuando termina el TTS anterior.
- **Alertas de proximidad.** Depth Anything V2 (métrico, ViT-S/Hypersim) corre sobre los mismos fotogramas; si detecta algo a ~50 cm, suena un pitido de aviso. Una calibración única convierte la altura del usuario en un factor de escala por dispositivo.
- **Navegación turn-by-turn.** Dada una frase de destino, el servidor la resuelve a coordenadas mediante Naver Search + geocodificación de Naver Cloud Maps, obtiene una ruta a pie y avanza por los waypoints conforme el GPS del navegador reporta nuevas posiciones.

## Arquitectura

```
Navegador (templates/index.html, static/script.js)
  │  fotogramas, GPS, TTS/STT
  ▼
Servidor Flask (server.py) ──► Gemini (visión)         descripción
                            ├► Depth Anything V2       aviso de proximidad
                            └► Naver Search + NCP Maps geocodificación + rutas
```

| Capa | Archivo / Módulo |
| --- | --- |
| HTTP + orquestación | `server.py` |
| Modelo de profundidad | `depth_anything_v2/` (backbone DINOv2 + cabeza DPT) |
| UI frontend | `templates/index.html`, `static/script.js`, `static/style.css` |
| Pitido de aviso | `static/1.wav` |
| Pesos del modelo | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## Requisitos previos

- Python 3.10 (conda recomendado)
- Se recomienda GPU compatible con CUDA. La calibración (`/calibrate`) está restringida a GPU; la inferencia de profundidad cae a CPU pero es lenta.
- Claves de API:
  - **Google Gemini** — al menos una (`API_KEY_1`); añade `API_KEY_2` y `API_KEY_3` para activar la rotación paralela.
  - **Naver Cloud Maps** — Static Map, Geocoding, Reverse Geocoding, Directions 5/15.
  - **Naver Search** — para convertir nombres de lugar a direcciones antes de geocodificar.

## Instalación

```bash
cp .env.template .env
# rellena API_KEY_1..3, NAVER_CLIENT_ID/SECRET, NCP_CLIENT_ID/SECRET

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## Pesos del modelo de profundidad

Coloca los pesos métricos de Depth Anything V2 en `checkpoints/`. El predeterminado es la variante pequeña de Hypersim (interior):

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

Otros tamaños (Base / Large) y la variante exterior VKITTI están disponibles en la [colección Depth Anything V2](https://huggingface.co/depth-anything). Cambiar de variante requiere editar `MODEL_CONFIGS` y el nombre del checkpoint en `server.py`.

## Ejecución

```bash
python server.py            # escucha en 0.0.0.0:8081
python server.py --debug    # activa el modo debug de Flask
```

Abre `http://<host>:8081` desde el navegador del teléfono (se requieren permisos de cámara y micrófono).

### Atajos de teclado (escritorio)

- `Space` — iniciar / detener el análisis automático de escena
- `Esc` — detener la navegación (si está activa) o cerrar el panel de ajustes

## Endpoints

| Método | Ruta | Propósito |
| --- | --- | --- |
| GET  | `/`                          | Web UI |
| GET  | `/get_models`                | Listar modelos Gemini disponibles |
| POST | `/describe`                  | Enviar fotograma, recibir descripción (auto-arranca el pipeline) |
| POST | `/upload_image`              | Registrar el último fotograma para el worker del pipeline |
| POST | `/start_auto_processing`    | Iniciar el worker de pipeline en segundo plano |
| POST | `/stop_auto_processing`     | Detener y limpiar worker, cola y última respuesta |
| GET  | `/get_response`              | Obtener la última descripción del pipeline |
| POST | `/set_tts_status`           | Indicar al servidor si el TTS está hablando |
| GET  | `/get_tts_status`           | Leer estado del TTS |
| GET  | `/get_queue_status`         | Diagnóstico: estado de pipeline / API / TTS |
| POST | `/calibrate`                 | Calibración única a partir de altura + profundidad central |
| POST | `/analyze_depth`             | Detectar objetos a ~50 cm con el factor de calibración |
| POST | `/start_navigation`         | Resolver destino, obtener ruta, crear sesión de navegación |
| POST | `/update_location`          | Avanzar por waypoints según el GPS actual |
| POST | `/navigation_describe`      | Describir un fotograma en el contexto de la ruta activa |
| GET  | `/get_current_instruction`  | Leer la instrucción del waypoint actual |
| POST | `/end_navigation`           | Marcar la sesión de navegación como inactiva |
| GET  | `/directions`                | Consulta de ruta puntual (sin sesión) |
| GET  | `/logs`, `/logs/clear`       | Ver / limpiar `server.log` |

## Cómo funciona la calibración

El usuario introduce su altura en cm. El servidor estima la longitud del brazo como `altura * 0.26 / 100` metros (ej. 175 cm → ~0.45 m), toma una lectura de profundidad en el centro de un fotograma sostenido a la distancia del brazo y guarda `longitud_del_brazo / profundidad_medida` como factor de escala por usuario. Los mapas de profundidad posteriores se multiplican por ese factor antes de aplicar el umbral de proximidad de 0.5 m.

## Notas

- El diseño con pipeline optimiza el *tiempo hasta la voz*: una nueva petición puede devolver al instante una descripción ya en cola mientras la siguiente se infiere en otra clave de API.
- Si el TTS está hablando o se ha disparado una señal de parada, las respuestas de Gemini se descartan, así nunca se lee una descripción obsoleta.
- Sólo está cableado el endpoint V1 (key-id / key) de Naver Cloud Maps Directions. La migración al esquema de autenticación v2 de API Gateway es trabajo futuro.

<div align="center">

<img src="assets/poster.png" alt="A-EYE Hauptabbildung" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**Deogyong Kim · Junhyeong Park · Jun Seong Lee**

Großer Preis (IITP-Direktorpreis) — Digitaler Universitätswettbewerb mit SW-Schwerpunkt 2025  
1. Preis — SK AI Summit *AI's Got Talent* (Nov. 2025)

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch**

</div>

---

## Überblick

Echtzeit-Webdienst für visuelle Assistenz für Sehbehinderte, der untersucht, ob große Sprachmodelle ein wirksamer Blindenhelfer sein können. Die Kamera des Telefons streamt Szenen an ein Flask-Backend, das Google Gemini (Vision-Sprach-Reasoning), Depth Anything V2 (metrische Tiefe für Näherungswarnung) und Naver Cloud Maps (Turn-by-Turn-Navigation) kombiniert, um knappe gesprochene Hinweise auf das Vorausliegende zu liefern.

## Funktionen

- **Szenen-Narration.** Erfasst Bilder von der Kamera, sendet sie an Gemini mit einem auf Fußgängersicherheit (Hindernisse, Beschilderung, ÖPNV-Infos) abgestimmten Prompt und liest die Antwort über das TTS des Browsers vor.
- **Pipelined-Inferenz.** Bis zu drei Gemini-API-Schlüssel werden parallel rotiert, sodass beim Ende eines TTS-Zyklus üblicherweise bereits eine neue Beschreibung bereitliegt.
- **Näherungswarnungen.** Depth Anything V2 (metrisch, ViT-S/Hypersim) läuft auf denselben Frames; wird etwas innerhalb von ~50 cm erkannt, ertönt ein Warnpiepton. Eine einmalige Kalibrierung wandelt die Körpergröße in einen geräteindividuellen Skalierungsfaktor um.
- **Turn-by-Turn-Navigation.** Mit einer Zielangabe löst der Server diese über Naver Search + Naver-Cloud-Maps-Geocoding zu Koordinaten auf, ruft eine Fußroute ab und schreitet die Wegpunkte fort, sobald das GPS neue Positionen meldet.

## Architektur

```
Browser (templates/index.html, static/script.js)
  │  Kamera-Frames, GPS, TTS/STT
  ▼
Flask-Server (server.py) ──► Gemini (Vision)             Szenenbeschreibung
                          ├► Depth Anything V2          Näherungswarnung
                          └► Naver Search + NCP Maps    Geocoding + Route
```

| Schicht | Datei / Modul |
| --- | --- |
| HTTP + Orchestrierung | `server.py` |
| Tiefenmodell | `depth_anything_v2/` (DINOv2-Backbone + DPT-Head) |
| Frontend-UI | `templates/index.html`, `static/script.js`, `static/style.css` |
| Warnton | `static/1.wav` |
| Modellgewichte | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## Voraussetzungen

- Python 3.10 (conda empfohlen)
- CUDA-fähige GPU empfohlen. Die Kalibrierung (`/calibrate`) ist auf GPU beschränkt; Tiefen-Inferenz läuft auch auf CPU, aber langsam.
- API-Schlüssel:
  - **Google Gemini** — mindestens einer (`API_KEY_1`); füge `API_KEY_2` und `API_KEY_3` hinzu, um die parallele Rotation zu aktivieren.
  - **Naver Cloud Maps** — Static Map, Geocoding, Reverse Geocoding, Directions 5/15.
  - **Naver Search** — wird verwendet, um Ortsnamen vor dem Geocoding in Adressen umzuwandeln.

## Einrichtung

```bash
cp .env.template .env
# trage API_KEY_1..3, NAVER_CLIENT_ID/SECRET, NCP_CLIENT_ID/SECRET ein

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## Tiefenmodell-Gewichte

Lege die Depth-Anything-V2-Metric-Depth-Gewichte unter `checkpoints/` ab. Standard ist die kleine Hypersim-Variante (innen):

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

Andere Größen (Base / Large) und die VKITTI-Variante für draußen sind in der [Depth-Anything-V2-Sammlung](https://huggingface.co/depth-anything) verfügbar. Ein Variantenwechsel erfordert derzeit das Bearbeiten von `MODEL_CONFIGS` und des Checkpoint-Dateinamens in `server.py`.

## Ausführen

```bash
python server.py            # lauscht auf 0.0.0.0:8081
python server.py --debug    # aktiviert den Flask-Debug-Modus
```

Öffne `http://<host>:8081` im Telefon-Browser (Kamera- und Mikrofon-Berechtigungen erforderlich).

### Tastenkürzel (Desktop)

- `Space` — Szenen-Auto-Analyse starten / stoppen
- `Esc` — Navigation stoppen (falls aktiv) oder Einstellungspanel schließen

## Endpoints

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET  | `/`                          | Web-UI |
| GET  | `/get_models`                | Verfügbare Gemini-Modelle auflisten |
| POST | `/describe`                  | Frame senden, Beschreibung erhalten (startet Pipelining automatisch) |
| POST | `/upload_image`              | Letzten Frame für den Pipelining-Worker registrieren |
| POST | `/start_auto_processing`    | Pipelining-Worker im Hintergrund starten |
| POST | `/stop_auto_processing`     | Worker, Queue und letzte Antwort stoppen und leeren |
| GET  | `/get_response`              | Letzte gepipelinete Beschreibung abrufen |
| POST | `/set_tts_status`           | Server mitteilen, ob TTS gerade spricht |
| GET  | `/get_tts_status`           | TTS-Status lesen |
| GET  | `/get_queue_status`         | Diagnose: Pipeline- / API- / TTS-Status |
| POST | `/calibrate`                 | Einmalige Kalibrierung aus Körpergröße + Mittentiefe |
| POST | `/analyze_depth`             | Objekte innerhalb ~50 cm mit dem Kalibrierungsfaktor erkennen |
| POST | `/start_navigation`         | Ziel auflösen, Route holen, Navigationssitzung erstellen |
| POST | `/update_location`          | Wegpunkte basierend auf aktuellem GPS fortschreiten |
| POST | `/navigation_describe`      | Frame im Kontext der aktiven Route beschreiben |
| GET  | `/get_current_instruction`  | Aktuelle Wegpunktanweisung lesen |
| POST | `/end_navigation`           | Navigationssitzung als inaktiv markieren |
| GET  | `/directions`                | Einmalige Routensuche (ohne Sitzung) |
| GET  | `/logs`, `/logs/clear`       | `server.log` ansehen / leeren |

## Wie die Kalibrierung funktioniert

Der Nutzer gibt seine Körpergröße in cm ein. Der Server schätzt die Armlänge auf `Größe * 0.26 / 100` Meter (z. B. 175 cm → ~0,45 m), liest die Tiefe in der Mitte eines mit ausgestrecktem Arm gehaltenen Frames und speichert `Armlänge / gemessene_Tiefe` als nutzerindividuellen Skalierungsfaktor. Anschließende Tiefenkarten werden mit diesem Faktor multipliziert, bevor die Näherungs-Schwelle von 0,5 m angewendet wird.

## Hinweise

- Das Pipelining-Design optimiert die *Zeit bis zur gesprochenen Ausgabe*: Eine neue Anfrage kann sofort eine bereits in der Queue liegende Beschreibung zurückgeben, während die nächste schon auf einem anderen API-Schlüssel inferiert wird.
- Gemini-Antworten werden verworfen, wenn das TTS gerade spricht oder ein Stoppsignal ausgelöst wurde, sodass nie eine veraltete Frame-Beschreibung vorgelesen wird.
- Aktuell ist nur der V1-Endpoint (key-id / key) von Naver Cloud Maps Directions angebunden. Die Migration zum API-Gateway-v2-Auth-Schema steht aus.

<div align="center">

<img src="assets/poster.png" alt="A-EYE figure principale" width="720"/>

# A-EYE: Can Large Language Models be an Effective Blind Helper?

**Deogyong Kim · Junhyeong Park · Jun Seong Lee**

Grand Prix (Prix du Directeur de l'IITP) — Concours Numérique Universitaire Axé Logiciel 2025  
1er Prix — SK AI Summit *AI's Got Talent* (Nov. 2025)

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md)

</div>

---

## Aperçu

Service web d'assistance visuelle en temps réel pour personnes malvoyantes, explorant si les grands modèles de langage peuvent servir d'assistant efficace pour aveugles. La caméra du téléphone diffuse les scènes vers un backend Flask qui combine Google Gemini (raisonnement vision-langage), Depth Anything V2 (profondeur métrique pour avertissement de proximité) et Naver Cloud Maps (navigation pas-à-pas) afin de fournir des indications vocales concises sur ce qui se trouve devant.

## Fonctionnalités

- **Narration de scène.** Capture des images de la caméra, les envoie à Gemini avec un prompt optimisé pour la sécurité piétonne (obstacles, signalisation, transports) et lit la réponse via le TTS du navigateur.
- **Inférence en pipeline.** Jusqu'à trois clés API Gemini sont alternées en parallèle, de sorte qu'une nouvelle description est généralement prête lorsque le TTS précédent se termine.
- **Alertes de proximité.** Depth Anything V2 (métrique, ViT-S/Hypersim) tourne sur les mêmes images ; si quelque chose est détecté à ~50 cm, un bip d'avertissement retentit. Une étape de calibration unique transforme la taille de l'utilisateur en facteur d'échelle par appareil.
- **Navigation pas-à-pas.** À partir d'une phrase de destination, le serveur la résout en coordonnées via Naver Search + géocodage Naver Cloud Maps, récupère un itinéraire piéton et progresse de waypoint en waypoint à mesure que le GPS du navigateur signale de nouvelles positions.

## Architecture

```
Navigateur (templates/index.html, static/script.js)
  │  images de la caméra, GPS, TTS/STT
  ▼
Serveur Flask (server.py) ──► Gemini (vision)             description
                            ├► Depth Anything V2          alerte de proximité
                            └► Naver Search + NCP Maps    géocodage + itinéraire
```

| Couche | Fichier / Module |
| --- | --- |
| HTTP + orchestration | `server.py` |
| Modèle de profondeur | `depth_anything_v2/` (backbone DINOv2 + tête DPT) |
| UI frontend | `templates/index.html`, `static/script.js`, `static/style.css` |
| Bip d'avertissement | `static/1.wav` |
| Poids du modèle | `checkpoints/depth_anything_v2_metric_hypersim_vits.pth` |

## Prérequis

- Python 3.10 (conda recommandé)
- GPU compatible CUDA recommandé. La calibration (`/calibrate`) est limitée au GPU ; l'inférence de profondeur peut tourner sur CPU mais lentement.
- Clés d'API :
  - **Google Gemini** — au moins une (`API_KEY_1`) ; ajoutez `API_KEY_2` et `API_KEY_3` pour activer la rotation parallèle.
  - **Naver Cloud Maps** — Static Map, Geocoding, Reverse Geocoding, Directions 5/15.
  - **Naver Search** — pour convertir les noms de lieux en adresses avant le géocodage.

## Installation

```bash
cp .env.template .env
# remplir API_KEY_1..3, NAVER_CLIENT_ID/SECRET, NCP_CLIENT_ID/SECRET

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
```

## Poids du modèle de profondeur

Placez les poids métriques de Depth Anything V2 dans `checkpoints/`. La variante par défaut est la version small Hypersim (intérieur) :

```bash
mkdir -p checkpoints
wget -O checkpoints/depth_anything_v2_metric_hypersim_vits.pth \
  https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Hypersim-Small/resolve/main/depth_anything_v2_metric_hypersim_vits.pth?download=true
```

D'autres tailles (Base / Large) et la variante extérieure VKITTI sont disponibles dans la [collection Depth Anything V2](https://huggingface.co/depth-anything). Changer de variante nécessite actuellement d'éditer `MODEL_CONFIGS` et le nom du checkpoint dans `server.py`.

## Exécution

```bash
python server.py            # écoute sur 0.0.0.0:8081
python server.py --debug    # active le mode debug de Flask
```

Ouvrez `http://<host>:8081` depuis le navigateur du téléphone (autorisations caméra et micro requises).

### Raccourcis clavier (bureau)

- `Space` — démarrer / arrêter l'analyse automatique de scène
- `Esc` — arrêter la navigation (si active) ou fermer le panneau de réglages

## Endpoints

| Méthode | Chemin | Usage |
| --- | --- | --- |
| GET  | `/`                          | Interface web |
| GET  | `/get_models`                | Lister les modèles Gemini disponibles |
| POST | `/describe`                  | Envoyer une image, recevoir une description (auto-démarre le pipeline) |
| POST | `/upload_image`              | Enregistrer la dernière image pour le worker du pipeline |
| POST | `/start_auto_processing`    | Démarrer le worker de pipeline en arrière-plan |
| POST | `/stop_auto_processing`     | Arrêter et nettoyer worker, file et dernière réponse |
| GET  | `/get_response`              | Récupérer la dernière description du pipeline |
| POST | `/set_tts_status`           | Indiquer au serveur si le TTS parle |
| GET  | `/get_tts_status`           | Lire l'état du TTS |
| GET  | `/get_queue_status`         | Diagnostic : état pipeline / API / TTS |
| POST | `/calibrate`                 | Calibration unique à partir de la taille + profondeur centrale |
| POST | `/analyze_depth`             | Détecter les objets à ~50 cm avec le facteur de calibration |
| POST | `/start_navigation`         | Résoudre la destination, obtenir l'itinéraire, créer une session |
| POST | `/update_location`          | Avancer dans les waypoints selon le GPS courant |
| POST | `/navigation_describe`      | Décrire une image dans le contexte de l'itinéraire actif |
| GET  | `/get_current_instruction`  | Lire l'instruction du waypoint courant |
| POST | `/end_navigation`           | Marquer la session de navigation comme inactive |
| GET  | `/directions`                | Recherche d'itinéraire ponctuelle (sans session) |
| GET  | `/logs`, `/logs/clear`       | Consulter / vider `server.log` |

## Comment fonctionne la calibration

L'utilisateur saisit sa taille en cm. Le serveur estime la longueur du bras à `taille * 0.26 / 100` mètres (ex. 175 cm → ~0,45 m), prend une mesure de profondeur au centre d'une image tenue à bout de bras, et stocke `longueur_du_bras / profondeur_mesurée` comme facteur d'échelle propre à l'utilisateur. Les cartes de profondeur suivantes sont multipliées par ce facteur avant comparaison au seuil de proximité de 0,5 m.

## Notes

- Le pipeline est conçu pour optimiser le *délai jusqu'à la parole* : une nouvelle requête peut renvoyer immédiatement une description en file, pendant que la suivante est en cours d'inférence sur une autre clé d'API.
- Les réponses de Gemini sont rejetées si le TTS parle ou si un signal d'arrêt a été émis, afin que l'utilisateur ne reçoive jamais une description obsolète.
- Seul l'endpoint V1 (key-id / key) de Naver Cloud Maps Directions est branché. La migration vers le schéma d'authentification v2 d'API Gateway est un travail futur.

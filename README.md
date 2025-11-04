![](assets/poster.png)
```bash
cp .env.template .env

# at env, you should do steps below
# 1. get google gemini api key (API_KEY)
# 2. get naver cloud maps api key (Static map, Geocoding, reverse geocoding, directions 5/15)
# 3. get naver search api (client key)

conda create -n aeye python=3.10
conda activate aeye
pip install -r requirements.txt
python server.py
```

To set depth anything model, refer to depthanything_v2_test/README.md
All checkpoints in this repo was downloaded from the referred route in depthanything_v2_test/README.md

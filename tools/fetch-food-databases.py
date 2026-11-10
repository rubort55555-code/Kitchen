# Скачивание открытых национальных баз состава продуктов для проверки разметки (tools/usda-iron-coverage.ts, tools/iron-coverage.ts).
# Данные в репозиторий не кладутся: скачиваются в папку из аргумента. Используется честный User-Agent; защиту сайтов от ботов не обходим,
# а сертификаты проверяем всегда: сайты, которые не отдают данные автоматически, нужно скачать вручную.
# Запуск: python3 -I tools/fetch-food-databases.py <папка>
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "kitchen-app-research/1.0"}
OUT = sys.argv[1] if len(sys.argv) > 1 else "food-databases"

def get(url, tries=4, timeout=300):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception as e:
            if i == tries - 1: print("  не удалось:", url, str(e)[:80]); return None
            time.sleep(8 * (i + 1))

def save(rel, url):
    p = os.path.join(OUT, rel)
    if os.path.exists(p) and os.path.getsize(p) > 1000: print("  уже есть", p); return p
    os.makedirs(os.path.dirname(p), exist_ok=True)
    b = get(url)
    if b: open(p, "wb").write(b); print("  скачано", p, len(b)); return p

# США: USDA FoodData Central, SR Legacy (CC0)
save("usda/sr_legacy.zip", "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip")
# Великобритания: CoFID 2021 (Open Government Licence)
save("cofid_uk/cofid.xlsx", "https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx")
# Канада: Canadian Nutrient File 2026 (Open Government Licence — Canada); файл отдаётся с opencanada.blob.core.windows.net
save("cnf_canada/cnf2026_all.zip", "https://open.canada.ca/data/dataset/1b6139bd-ed7e-4043-bc28-ff00e10f3109/resource/019f2a90-e3a9-489d-b6e1-f74f4ba1d006/download/cnf_fcen_all-files-data_2026.zip")
# Швеция: Livsmedelsverket, открытый API: список продуктов и железо, кальций, витамин C по каждому (4 потока)
lst = get("https://dataportal.livsmedelsverket.se/livsmedel/api/v1/livsmedel?offset=0&limit=3000&sprak=1")
if lst:
    foods = json.loads(lst)["livsmedel"]
    def one(f):
        row = {"nummer": f["nummer"], "namn": f["namn"], "typ": f.get("livsmedelsTyp")}
        b = get(f"https://dataportal.livsmedelsverket.se/livsmedel/api/v1/livsmedel/{f['nummer']}/naringsvarden?sprak=1")
        for r in (json.loads(b) if b else []):
            if r.get("euroFIRkod") in ("FE", "CA", "VITC"): row[r["euroFIRkod"]] = r.get("varde")
        time.sleep(0.1)
        return row
    with ThreadPoolExecutor(4) as ex: rows = list(ex.map(one, foods))
    os.makedirs(OUT + "/livsmedelsverket_se", exist_ok=True)
    json.dump(rows, open(OUT + "/livsmedelsverket_se/iron.json", "w"), ensure_ascii=False)
    print("  Швеция:", len(rows), "продуктов")

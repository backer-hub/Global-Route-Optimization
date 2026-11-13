import urllib.request
import json
import sys

tests = [
    # 2 waypoints
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 21998], 'engine': 'astar'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 21998], 'engine': 'openmp'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 21998], 'engine': 'cuda'},
    # 3 waypoints: Shanghai -> NY -> Rotterdam
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 21998], 'engine': 'astar'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 21998], 'engine': 'openmp'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 21998], 'engine': 'cuda'},
    # 4 waypoints: Shanghai -> NY -> SF -> Rotterdam
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 17895, 21998], 'engine': 'astar'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 17895, 21998], 'engine': 'openmp'},
    {'origin_id': 55196, 'dest_id': 21998, 'waypoints': [55196, 6383, 17895, 21998], 'engine': 'cuda'},
]

def main():
    failed = 0
    for t in tests:
        try:
            req = urllib.request.Request(
                'http://127.0.0.1:5000/api/route',
                data=json.dumps(t).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            res = urllib.request.urlopen(req, timeout=35)
            d = json.loads(res.read().decode())
            nodes_len = len(d.get("nodes", []))
            dist = d.get("total_distance_km", 0)
            eng = d.get("engine", "")
            print(f"PASS: engine={t['engine']:<8} wp_len={len(t['waypoints'])} -> HTTP {res.status} | nodes={nodes_len} | dist={dist:.1f} km | eng={eng}")
        except urllib.error.HTTPError as e:
            failed += 1
            err_body = e.read().decode()
            print(f"FAIL (HTTP {e.code}): engine={t['engine']:<8} wp_len={len(t['waypoints'])} -> {err_body[:200]}")
        except Exception as ex:
            failed += 1
            print(f"ERROR: engine={t['engine']:<8} wp_len={len(t['waypoints'])} -> {ex}")
    return int(failed > 0)


if __name__ == '__main__':
    sys.exit(main())

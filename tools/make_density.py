"""譜面のノーツ密度（1 秒ごとのノーツ数）を textage の譜面から計算して data/density.tsv に書く（2026-11-26）。

usage: python tools/make_density.py [--legg] [--music <music.tsv>] [--wait 2]
  --legg   LEGGENDARIA（SPL）がある曲だけ（最初の試し。textage は 1 曲 1 ページなので、その曲の SPN/SPH/SPA も一緒に作る）

- 楽曲は music.tsv（既定は G: の同期フォルダの写し）。対象は SPN / SPH / SPA / SPL（DP と BEGINNER は作らない）
- 譜面の読み取りは F:\\node\\InfinitasVideoTool\\playan\\textage_chart.py（RANDOM の並びの逆算と同じもの。直すのは 1 か所にしておく）
- textage のページは playan/textage_cache/ に保存して使い回す（取り直さない。曲一覧 titletbl / datatbl は 7 日で取り直す）。1 ページごとに --wait 秒あける
- textage から数えたノーツ数が music.tsv のノーツ数とぴったり合う譜面だけ書く。合わない・textage に無い・読めない譜面は最後に一覧で出す
- 1 秒ごとの区切りは譜面の頭（空の小節も含めた 0 秒）から。ゲームのリザルトの Digitank と同じ（百恋ラブラスター SPA で照合、ずれ平均 0.23 ノーツ）
- avg は ノーツ数 ÷（最初のノーツから最後のノーツまでの秒数）。ゲームは曲の長さ（余韻込み）で割るので少し低く出るが、曲の長さのデータが無いので一定の基準としてこれにする（2026-11-26 ユーザーと決定）
- 前回の density.tsv の行は、今回作らなかった曲の分を残す（範囲を広げていけるように）

出力 data/density.tsv: title / type / notes / avg / max / sec（1 秒ごとのノーツ数をカンマ区切り）
"""
import argparse, html, math, os, re, sys, time, unicodedata, urllib.request

PLAYAN = r'F:\node\InfinitasVideoTool\playan'
sys.path.insert(0, PLAYAN)
import textage_chart  # noqa: E402

CACHE = os.path.join(PLAYAN, 'textage_cache')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, 'data', 'density.tsv')
MUSIC = r'G:\マイドライブ\INFINITAS履歴\music.tsv'
UA = {'User-Agent': 'Mozilla/5.0'}
TYPES = ['SPN', 'SPH', 'SPA', 'SPL']
# music.tsv の譜面 → textage_chart の難易度（L=NORMAL の欄、X=通常のページの中の LEGGENDARIA）
LABEL = {'SPN': 'L', 'SPH': 'H', 'SPA': 'A', 'SPL': 'X'}
WAIT = 2.0
fetched = 0


def fetch(url, path, max_age_days=None):
    global fetched
    if os.path.exists(path) and (max_age_days is None or time.time() - os.path.getmtime(path) < max_age_days * 86400):
        return path
    if fetched:
        time.sleep(WAIT)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    with open(path, 'wb') as f:
        f.write(data)
    fetched += 1
    return path


def norm_title(s):
    """表記ゆれを吸収した曲名（random_playlist.py と同じ。† も消えるので「曲名†」の別ページも同じ名前になる）"""
    s = re.sub(r'<[^>]*>', '', s)   # textage の曲名の改行 "<br>"（お米の美味しい炊き方、<br>そして…）
    s = unicodedata.normalize('NFKC', html.unescape(s)).lower()
    return ''.join(ch for ch in s if ch.isalnum())


def textage_songs():
    t = {}
    for name in ('titletbl', 'datatbl'):
        p = fetch('https://textage.cc/score/%s.js' % name, os.path.join(CACHE, name + '.js'), max_age_days=7)
        t[name] = open(p, 'rb').read().decode('cp932', 'replace')
    songs = {}
    for m in re.finditer(r"^'([^']+)'\s*:\s*\[(\d+),\d+,\d+,\"(?:[^\"\\]|\\.)*\"(?:/\*.*?\*/)?,\"(?:[^\"\\]|\\.)*\",\"((?:[^\"\\]|\\.)*)\"(?:,\"((?:[^\"\\]|\\.)*)\")?",
                         t['titletbl'], re.M):
        songs[m.group(1)] = {'ver': int(m.group(2)), 'title': m.group(3), 'sub': m.group(4) or ''}
    for m in re.finditer(r"^'([^']+)'\s*:\s*\[([^\]]*)\]", t['datatbl'], re.M):
        if m.group(1) in songs:
            v = [x.strip() for x in m.group(2).split(',')]
            try:
                songs[m.group(1)]['sp'] = [int(x) for x in v[1:6]]   # SP の BEGINNER, NORMAL, HYPER, ANOTHER, LEGGENDARIA
            except ValueError:
                songs[m.group(1)]['sp'] = []
    by_name, by_title = {}, {}
    for k, s in songs.items():
        for n in {norm_title(s['title']), norm_title(s['title'] + s['sub'])}:
            by_name.setdefault(n, []).append(k)
        by_title.setdefault(norm_title(s['title']), []).append(k)
    return songs, by_name, by_title


def read_music(path):
    lines = [l for l in open(path, encoding='utf-8-sig').read().splitlines() if l.strip()]
    if lines[0].startswith('# '):
        lines = lines[1:]
    col = {h: i for i, h in enumerate(lines[0].split('\t'))}
    out = []
    for line in lines[1:]:
        c = line.split('\t')
        v = lambda name: c[col[name]] if col.get(name) is not None and col[name] < len(c) else ''
        charts = {}
        for t in TYPES:
            if (v('%s level' % t) or '0') not in ('', '0'):
                charts[t] = int(v('%s notes' % t) or 0)
        out.append((v('title'), charts))
    return out


def density(notes):
    ts = sorted(n[0] for n in notes)
    bins = [0] * (math.floor(ts[-1]) + 1)
    for t in ts:
        bins[int(t)] += 1
    span = ts[-1] - ts[0]
    return (len(ts) / span if span > 0 else 0.0), max(bins), bins


def main():
    global WAIT
    ap = argparse.ArgumentParser()
    ap.add_argument('--legg', action='store_true', help='LEGGENDARIA のある曲だけ')
    ap.add_argument('--music', default=MUSIC)
    ap.add_argument('--wait', type=float, default=WAIT)
    a = ap.parse_args()
    WAIT = a.wait
    songs, by_name, by_title = textage_songs()
    music = read_music(a.music)
    if a.legg:
        music = [m for m in music if 'SPL' in m[1]]
    rows, missing = {}, []
    t0 = time.time()
    for i, (title, charts) in enumerate(music, 1):
        keys = list(by_name.get(norm_title(title), []))
        if not keys:
            missing.extend((title, t, 'textage に曲がない') for t in charts)
            continue
        # LEGGENDARIA の別ページはサブタイトルが付いていないことがある（RIDE ON THE LIGHT (HI GREAT MIX) → rideon_l）。
        # 見つかった曲と同じ曲名（サブタイトル抜き）のページも候補に入れる
        if 'SPL' in charts:
            for k in list(keys):
                keys += [k2 for k2 in by_title.get(norm_title(songs[k]['title']), []) if k2 not in keys]
        # いちばん譜面の多いページを「本体」、ほかは LEGGENDARIA の別ページ（「曲名†」や、同じ曲名の closewdl など）とみなす。
        # 曲名そのものに † がある曲（DEATH†ZIGOQ）もあるので、† の有無では決めない（2026-11-26）
        keys.sort(key=lambda k: -sum(1 for x in songs[k].get('sp', []) if x))
        main = keys[0]
        pages = {}
        for k in keys:
            try:
                pages[k] = fetch('https://textage.cc/score/%d/%s.html' % (songs[k]['ver'], k),
                                 os.path.join(CACHE, '%d_%s.html' % (songs[k]['ver'], k)))
            except Exception as e:  # noqa: BLE001
                print('  取れない %s: %s' % (k, e), flush=True)
        cache = {}

        def chart(k, lab):
            if (k, lab) not in cache:
                try:
                    cache[(k, lab)] = textage_chart.chart_notes(pages[k], lab)
                except Exception as e:  # noqa: BLE001
                    cache[(k, lab)] = e
            return cache[(k, lab)]

        for t, want in charts.items():
            # まず決まった欄、だめなら（† の別ページなど）ほかの欄も見て、ノーツ数がぴったり合うものを使う
            tries = [(main, LABEL[t])] if main in pages else []
            if t == 'SPL':
                tries += [(k, lab) for k in pages if k != main for lab in ('A', 'X', 'H', 'L')]
            got, errs = None, []
            for k, lab in tries:
                c = chart(k, lab)
                if isinstance(c, Exception):
                    errs.append('%s/%s 読めない（%s）' % (k, lab, c))
                elif c and len(c) == want:
                    got = c
                    break
                elif c:
                    errs.append('%s/%s %d ノーツ' % (k, lab, len(c)))
            if got:
                avg, mx, bins = density(got)
                rows[(title, t)] = '%s\t%s\t%d\t%.2f\t%d\t%s' % (title, t, want, avg, mx, ','.join(map(str, bins)))
            else:
                missing.append((title, t, 'music.tsv %d ノーツ / textage %s' % (want, '、'.join(errs) or '譜面なし')))
        if i % 20 == 0:
            print('  %d / %d 曲（%.0f 秒、取ったページ %d）' % (i, len(music), time.time() - t0, fetched), flush=True)
    # 前回の行のうち、今回作らなかった曲の分は残す
    done_titles = {m[0] for m in music}
    if os.path.exists(OUT):
        for line in open(OUT, encoding='utf-8').read().splitlines()[1:]:
            c = line.split('\t')
            if len(c) >= 6 and c[0] not in done_titles:
                rows[(c[0], c[1])] = line
    order = {t: i for i, t in enumerate(TYPES)}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('title\ttype\tnotes\tavg\tmax\tsec\n')
        for key in sorted(rows, key=lambda k: (k[0], order[k[1]])):
            f.write(rows[key] + '\n')
    print('書いた譜面 %d（今回 %d 曲から）、作れなかった譜面 %d、取ったページ %d、%.0f 秒' % (
        len(rows), len(music), len(missing), fetched, time.time() - t0))
    for title, t, why in missing:
        print('  × %s %s: %s' % (title, t, why))


if __name__ == '__main__':
    main()

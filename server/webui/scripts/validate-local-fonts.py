#!/usr/bin/env python3
"""Offline binary checks. Requires fontTools, woff2_decompress and libharfbuzz.

No fonts, caches or generated files are written into the checkout.
"""
import ctypes as C
import ctypes.util
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unicodedata

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'static/fonts'
RECORDS = json.loads((FONTS / 'sources.json').read_text())
PL = 'Zażółć gęślą jaźń — Łódź, źródło, ąęśćż ĄĆĘŁŃÓŚŹŻ'
BG = 'Български език: Щъркелът търси път към къщи. Нейната книга и ѝ. Ѝ'
EL = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ αβγδεζηθικλμνξοπρστυφχψως άέήίόύώ ΐΰϊϋΪΫ ἄνθρωπος'


def points(value):
    result = set()
    for part in value.replace('U+', '').split(','):
        pair = part.strip().split('-')
        result.update(range(int(pair[0], 16), int(pair[-1], 16) + 1))
    return result


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def harfbuzz():
    lib = C.CDLL(ctypes.util.find_library('harfbuzz'))

    def bind(name, args, result):
        function = getattr(lib, name)
        function.argtypes = args
        function.restype = result
        return function

    pointer, uint, string = C.c_void_p, C.c_uint, C.c_char_p

    class Variation(C.Structure):
        _fields_ = [('tag', uint), ('value', C.c_float)]

    class Glyph(C.Structure):
        _fields_ = [(key, uint) for key in ['codepoint', 'mask', 'cluster', 'var1', 'var2']]

    blob = bind('hb_blob_create', [string, uint, C.c_int, pointer, pointer], pointer)
    face = bind('hb_face_create', [pointer, uint], pointer)
    font = bind('hb_font_create', [pointer], pointer)
    ot = bind('hb_ot_font_set_funcs', [pointer], None)
    buffer = bind('hb_buffer_create', [], pointer)
    add = bind('hb_buffer_add_utf8', [pointer, string, C.c_int, uint, C.c_int], None)
    language = bind('hb_language_from_string', [string, C.c_int], pointer)
    set_language = bind('hb_buffer_set_language', [pointer, pointer], None)
    guess = bind('hb_buffer_guess_segment_properties', [pointer], None)
    shape = bind('hb_shape', [pointer, pointer, pointer, uint], None)
    variations = bind('hb_font_set_variations', [pointer, C.POINTER(Variation), uint], None)
    infos = bind('hb_buffer_get_glyph_infos', [pointer, C.POINTER(uint)], C.POINTER(Glyph))
    destroy_buffer = bind('hb_buffer_destroy', [pointer], None)
    destroy_font = bind('hb_font_destroy', [pointer], None)
    destroy_face = bind('hb_face_destroy', [pointer], None)
    destroy_blob = bind('hb_blob_destroy', [pointer], None)

    def run(path, text, lang, weight):
        data = path.read_bytes()
        b = blob(data, len(data), 0, None, None)
        fa = face(b, 0)
        f = font(fa)
        ot(f)
        variations(f, (Variation * 1)(Variation(int.from_bytes(b'wght', 'big'), weight)), 1)
        buf = buffer()
        encoded = text.encode()
        add(buf, encoded, len(encoded), 0, len(encoded))
        set_language(buf, language(lang.encode(), -1))
        guess(buf)
        shape(f, buf, None, 0)
        length = uint()
        glyphs = infos(buf, C.byref(length))
        result = [glyphs[i].codepoint for i in range(length.value)]
        destroy_buffer(buf)
        destroy_font(f)
        destroy_face(fa)
        destroy_blob(b)
        return result

    return run


check(shutil.which('woff2_decompress'), 'Install the Google woff2 tools')
check({r['file'] for r in RECORDS} == {p.name for p in FONTS.glob('*.woff2')}, 'Inventory mismatch')
check(len(RECORDS) == len({r['file'] for r in RECORDS}), 'Duplicate font records')
css = (ROOT / 'src/lib/styles/local-fonts.css').read_text()
check(len(re.findall(r'@font-face\s*\{', css)) == len(RECORDS), 'CSS inventory mismatch')
coverage, decoded, evidence = {}, {}, []
temporary_root = '/tmp/opencode' if Path('/tmp/opencode').exists() else None
with tempfile.TemporaryDirectory(prefix='llampart-font-check-', dir=temporary_root) as directory:
    temp = Path(directory)
    for record in RECORDS:
        path = FONTS / record['file']
        data = path.read_bytes()
        check(len(data) == record['bytes'], str(path) + ': size')
        check(hashlib.sha256(data).hexdigest() == record['sha256'], str(path) + ': SHA-256')
        license_text = (FONTS / record['license']).read_text()
        check('SIL OPEN FONT LICENSE Version 1.1' in license_text, str(path) + ': license')
        copy = temp / path.name
        copy.write_bytes(data)
        subprocess.run(['woff2_decompress', str(copy)], check=True, capture_output=True)
        ttf = copy.with_suffix('.ttf')
        font = TTFont(ttf)
        decoded[record['file']] = (font, ttf)
        cmap = set(font.getBestCmap())
        declared = points(record['unicodeRange'])
        check(declared <= cmap, str(path) + ': unicode-range contains absent codepoints')
        check(font['name'].getDebugName(5) == record['version'], str(path) + ': revision')
        check(font['OS/2'].fsType == 0, str(path) + ': embedding restriction')
        italic = bool(font['OS/2'].fsSelection & 1)
        check(italic == (record['style'] == 'italic'), str(path) + ': style')
        axes = {a.axisTag: [a.minValue, a.defaultValue, a.maxValue] for a in font['fvar'].axes} if 'fvar' in font else {}
        check(axes == record['axes'], str(path) + ': axes')
        weights = list(map(int, record['weight'].split()))
        if axes:
            check(weights == [axes['wght'][0], axes['wght'][2]], str(path) + ': variable range')
        else:
            check(weights == [font['OS/2'].usWeightClass], str(path) + ': static weight')
        key = (record['family'], record['style'], record['weight'])
        coverage.setdefault(key, set()).update(declared)
        evidence.append(dict(file=record['file'], cmap=len(cmap), declared=len(declared), version=record['version']))

    for (family, style, weight), cmap in coverage.items():
        samples = [PL] if family in ['Barlow', 'Domine'] else [EL] if family == 'Tinos' else [PL, BG] if family == 'Merriweather' else [PL, BG, EL]
        for sample in samples:
            # Tinos is a Greek-only CSS fallback; ASCII belongs to Merriweather.
            required = set(map(ord, sample))
            if family == 'Tinos':
                required = {c for c in required if c >= 0x300}
            check(required <= cmap, f'{family} {style} {weight}: missing {required - cmap}')
        if family in ['Tinos', 'Inter', 'Google Sans', 'Fira Sans', 'Literata']:
            nfd = {ord(c) for c in unicodedata.normalize('NFD', EL.split(' ἄνθρωπος')[0]) if ord(c) >= 0x300}
            check(nfd <= cmap, f'{family}: missing Greek NFD marks {nfd - cmap}')

    shape = harfbuzz()
    for record in RECORDS:
        if record['family'] in ['Google Sans', 'Inter', 'Tinos', 'Literata'] or record['file'].startswith('fira-sans-greek-'):
            _, path = decoded[record['file']]
            for normalization in ['NFC', 'NFD']:
                glyphs = shape(path, unicodedata.normalize(normalization, EL), 'el', 700)
                check(0 not in glyphs, record['file'] + ': Greek shaping ' + normalization)
    for style in ['normal', 'italic']:
        font, path = decoded[f'merriweather-cyrillic-wght-{style}.woff2']
        table = font['GSUB'].table
        cyrl = next(s.Script for s in table.ScriptList.ScriptRecord if s.ScriptTag == 'cyrl')
        check(any(l.LangSysTag == 'BGR ' for l in cyrl.LangSysRecord), 'Missing BGR language system')
        for weight in [400, 700]:
            text = 'ДЛФ вгджзийѝклнптфцчшщьъю Ѝ'
            bg = shape(path, text, 'bg', weight)
            en = shape(path, text, 'en', weight)
            check(0 not in bg and bg != en, f'BG locl not activated: {style} {weight}')
            order = font.getGlyphOrder()
            localized = [order[i] for i in bg if 'loclBGR' in order[i]]
            check('uni045D.loclBGR' in localized and 'uni040D.loclBGR' in localized, 'Missing localized grave letters')
            print(json.dumps(dict(test='HarfBuzz BG locl', style=style, weight=weight, localized=localized)))

print(json.dumps(dict(result='PASS', files=len(RECORDS), bytes=sum(r['bytes'] for r in RECORDS), fonts=evidence)))

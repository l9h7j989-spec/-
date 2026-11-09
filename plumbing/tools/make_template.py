"""견적서 HWPX 양식 생성기 (python-hwpx 사용) — 사장님이 쓰던 엑셀 견적서 모양을 따름.

앱은 이 양식 안의 {{자리표시자}} 를 실제 값으로 바꿔서 견적서를 만든다.
- 품목 행: {{name}} 이 있는 행을 품목 수만큼 복제 (빈 줄로 최소 줄 수를 채움)
- 도장: BinData 안의 투명 그림(stamp)을 앱에서 사용자가 올린 도장 그림으로 바꿔 넣음

사용: pip install python-hwpx && python tools/make_template.py templates/estimate_template.hwpx
"""
import base64
import sys
import warnings

from hwpx import HwpxDocument

warnings.filterwarnings("ignore", category=DeprecationWarning)
out = sys.argv[1] if len(sys.argv) > 1 else "estimate_template.hwpx"
doc = HwpxDocument.new()
doc.set_page_margins(left=5669, right=5669, top=4252, bottom=4252)
W = 48190  # 본문 폭

cp = lambda **k: doc.ensure_run_style(**k)
title_cp = cp(bold=True, size=26, underline=True)
date_cp = cp(size=12)
site_cp = cp(bold=True, size=15, underline=True)
company_cp = cp(bold=True, size=18)
bold12 = cp(bold=True, size=12)
bold12u = cp(bold=True, size=12, underline=True)
norm10 = cp(size=10)
total_cp = cp(bold=True, size=13)
head_cp = cp(size=9)
item_cp = cp(size=9.5)
bold10 = cp(bold=True, size=10)


def para(text, char, align=None):
    p = doc.add_paragraph(text, char_pr_id_ref=char)
    if align:
        doc.set_paragraph_format(paragraph_index=len(doc.paragraphs) - 1, alignment=align)
    return p


# 정렬용 문단모양 id 얻기
center_pr = para("見     積     書", title_cp, "CENTER").element.get("paraPrIDRef")
right_pr = para("{{year}} 年  {{month}} 月  {{day}} 日", date_cp, "RIGHT").element.get("paraPrIDRef")

no_border = doc.styles.ensure_border_fill(border_color="#FFFFFF", border_width="0.1 mm", active_borders=[])
line = doc.styles.ensure_border_fill(border_color="#000000", border_width="0.12 mm")
green = doc.styles.ensure_border_fill(border_color="#000000", border_width="0.12 mm", fill_color="#CCFFCC")


def fill(cell, text, char, pr=None):
    cell.set_text(text)
    for p in cell.paragraphs:
        if pr:
            p.element.set("paraPrIDRef", str(pr))
        for r in p.element.iter():
            if r.tag.endswith("}run"):
                r.set("charPrIDRef", str(char))


# ── 1. 머리 (테두리 없는 표: 왼쪽 현장, 오른쪽 업체) ──
head = doc.add_table(5, 2, width=W, border_fill_id_ref=no_border)
head.set_column_widths([25500, 22690])
rows = [
    (("{{site}}", site_cp, center_pr), ("{{company}}", company_cp, None)),
    (("공사명 : {{title}}", bold12u, None), ("대  표 : {{owner}}  ", bold12, None)),
    (("貴社에서 依賴하신 見積은", bold12, None), ("{{company_address}}", norm10, None)),
    (("아래와 같습니다.", bold12, None), ("TEL : {{company_tel}}", norm10, None)),
    (("", norm10, None), ("H.P : {{company_phone}}", norm10, None)),
]
for r, cells in enumerate(rows):
    for c, (t, ch, pr) in enumerate(cells):
        head.set_cell_border_fill(r, c, no_border)
        fill(head.cell(r, c), t, ch, pr)

# 도장 자리 (투명 그림. 앱이 사용자 도장으로 교체)
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
stamp_id = doc.add_image(TRANSPARENT_PNG, "png", item_id="stamp")
owner_p = head.cell(1, 1).paragraphs[0]
owner_p.add_picture(stamp_id, width=3800, height=3800, char_pr_id_ref=bold12)

para("", norm10)

# ── 2. 합계 금액 띠 ──
band = doc.add_table(1, 1, width=W, border_fill_id_ref=green)
band.set_cell_border_fill(0, 0, green)
fill(band.cell(0, 0), "合計金額 : {{total_korean}}원整  (￦ {{total}} )  *부가가치세 {{vat_label}}", total_cp)

para("", norm10)

# ── 3. 품목 표 ──
hdr = ("NO", "品  名  및  規  格", "單 位", "數 量", "單   價", "金       額", "備   考")
items = doc.add_table(4, 7, width=W, border_fill_id_ref=line)
items.set_column_widths([2600, 13400, 4400, 4400, 6100, 8900, 8390])
for c, t in enumerate(hdr):
    items.set_cell_border_fill(0, c, line)
    fill(items.cell(0, c), t, head_cp, center_pr)
ph = ("{{no}}", "{{name}}", "{{unit}}", "{{qty}}", "{{price}}", "{{amount}}", "{{note}}")
for c, t in enumerate(ph):
    fill(items.cell(1, c), t, item_cp, center_pr if c != 1 else center_pr)
# 합계 행
fill(items.cell(2, 1), "합    계", bold10, center_pr)
fill(items.cell(2, 5), "{{total}}", bold10, center_pr)
# 마지막 줄: 특기사항
items.merge_cells(3, 0, 3, 6)
fill(items.cell(3, 0), "{{memo}}", item_cp)

doc.save_to_path(out)
print("validate:", doc.validate())

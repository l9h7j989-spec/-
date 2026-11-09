"""예시 견적서 HWPX 양식 생성기 (python-hwpx 사용).

앱은 이 양식 안의 {{자리표시자}} 를 실제 값으로 바꿔서 견적서를 만든다.
품목 행은 {{name}} 이 들어있는 표의 행을 품목 수만큼 복제한다.
실제 양식이 오면: 한글에서 양식을 열고 같은 {{자리표시자}} 를 적은 뒤 .hwpx 로 저장하면 된다.
"""
import sys
from hwpx import HwpxDocument

out = sys.argv[1] if len(sys.argv) > 1 else "estimate_template.hwpx"
doc = HwpxDocument.new()
doc.set_page_margins(left=5669, right=5669, top=4252, bottom=4252)

title_cp = doc.ensure_run_style(bold=True, size=22)
bold_cp = doc.ensure_run_style(bold=True, size=10)
norm_cp = doc.ensure_run_style(size=10)
small_cp = doc.ensure_run_style(size=9)
total_cp = doc.ensure_run_style(bold=True, size=12)

def para(text, cp, align=None):
    p = doc.add_paragraph(text, char_pr_id_ref=cp)
    if align:
        idx = len(doc.paragraphs) - 1
        doc.set_paragraph_format(paragraph_index=idx, alignment=align)
    return p

# 첫 문단(secPr 보유)은 비워 두고 제목
p_title = para("견   적   서", title_cp, "CENTER")
center_pr = p_title.element.get("paraPrIDRef")
p_r = para("", norm_cp, "RIGHT")
right_pr = p_r.element.get("paraPrIDRef")
p_r.element.getparent().remove(p_r.element) if hasattr(p_r.element, "getparent") else None

bf = doc.ensure_border_fill(border_color="#000000", border_width="0.12 mm")
bf_head = doc.ensure_border_fill(border_color="#000000", border_width="0.12 mm", fill_color="#E8EEF5")

def fill(cell, text, cp=norm_cp, pr=None):
    ps = cell.paragraphs
    ps[0].element.set("paraPrIDRef", str(pr)) if pr else None
    cell.set_text(text)
    for p in cell.paragraphs:
        if pr:
            p.element.set("paraPrIDRef", str(pr))
        for r in p.element.iter():
            if r.tag.endswith("}run"):
                r.set("charPrIDRef", str(cp))

W = 48190  # 본문 폭 (A4 - 여백)

# ── 1. 수신/공급자 표 ──
info = doc.add_table(6, 4, width=W, border_fill_id_ref=bf)
info.set_column_widths([7000, 17095, 7000, 17095])
rows = [
    ("견적일자", "{{date}}", "상    호", "{{company}}"),
    ("수    신", "{{customer}} 귀하", "대 표 자", "{{owner}}"),
    ("연 락 처", "{{phone}}", "사업자번호", "{{bizno}}"),
    ("현장주소", "{{address}}", "연 락 처", "{{company_phone}}"),
    ("공 사 명", "{{title}}", "주    소", "{{company_address}}"),
    ("유효기간", "견적일로부터 {{valid_days}}일", "계좌번호", "{{account}}"),
]
for r, row in enumerate(rows):
    for c, t in enumerate(row):
        cell = info.cell(r, c)
        if c in (0, 2):
            info.set_cell_border_fill(r, c, bf_head) if hasattr(info, "set_cell_border_fill") else None
            fill(cell, t, bold_cp, center_pr)
        else:
            fill(cell, t, norm_cp)

para("", norm_cp)
para("아래와 같이 견적합니다.", norm_cp)
p_sum = para("합계금액 : 일금 {{total_korean}}원정 (￦{{total}})  ※ 부가세 {{vat_label}}", total_cp)
para("", small_cp)

# ── 2. 품목 표 ──
hdr = ("No", "품명", "규격", "수량", "단위", "단가", "금액", "비고")
widths = [2600, 13000, 7000, 3800, 3600, 6400, 7000, 4790]
items = doc.add_table(5, 8, width=W, border_fill_id_ref=bf)
items.set_column_widths(widths)
for c, t in enumerate(hdr):
    items.set_cell_border_fill(0, c, bf_head)
    fill(items.cell(0, c), t, bold_cp, center_pr)
ph = ("{{no}}", "{{name}}", "{{spec}}", "{{qty}}", "{{unit}}", "{{price}}", "{{amount}}", "{{note}}")
for c, t in enumerate(ph):
    fill(items.cell(1, c), t, small_cp, center_pr if c in (0, 3, 4) else (right_pr if c in (5, 6) else None))
summary = [("공급가액", "{{supply}}"), ("부 가 세", "{{vat}}"), ("합    계", "{{total}}")]
for i, (k, v) in enumerate(summary):
    r = 2 + i
    items.merge_cells(r, 0, r, 5)
    items.merge_cells(r, 6, r, 7)
    items.set_cell_border_fill(r, 0, bf_head)
    fill(items.cell(r, 0), k, bold_cp, center_pr)
    fill(items.cell(r, 6), v, bold_cp, right_pr)

para("", norm_cp)
para("※ 특기사항", bold_cp)
para("{{memo}}", norm_cp)
para("", norm_cp)
para("{{company}}  대표 {{owner}}  (인)", bold_cp, "RIGHT")

doc.save_to_path(out)
rep = doc.validate()
print("validate:", rep)

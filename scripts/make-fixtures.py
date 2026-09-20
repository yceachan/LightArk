"""Create tiny, deterministic PDF and DOCX fixtures without external packages."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures'
root.mkdir(exist_ok=True)
stream = b'BT /F1 26 Tf 60 740 Td (Research notes) Tj 0 -48 Td /F1 12 Tf (A quiet place for ideas. Add a note anywhere on this page.) Tj ET'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
pdf=b'%PDF-1.4\n'; offsets=[0]
for n,obj in enumerate(objects,1):
 offsets.append(len(pdf));pdf+=f'{n} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{o:010} 00000 n \n'.encode() for o in offsets[1:])+f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()
(root/'research.pdf').write_bytes(pdf)
with ZipFile(root/'field-notes.docx','w',ZIP_DEFLATED) as z:
 z.writestr('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 z.writestr('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 z.writestr('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>Field notes</w:t></w:r></w:p><w:p><w:r><w:t>把值得留下的想法收在一起。</w:t></w:r></w:p><w:p><w:r><w:t>This is a real DOCX document, rendered locally in your browser.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>')
(root/'rendering.md').write_text('''# Markdown rendering\n\n## Math and code\n\n$E = mc^2$\n\n```rust\nfn main() { println!("Folio"); }\n```\n\n> [!NOTE]\n> A useful note.\n\n- [x] Read\n- [ ] Think\n\n```mermaid\nflowchart LR\n  Files --> Knowledge\n```\n\n<script>window.pwned=true</script>\n''')

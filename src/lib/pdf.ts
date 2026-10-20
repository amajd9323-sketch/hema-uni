import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageText } from '../types';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdf(file: File): Promise<PageText[]> {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('ارفع ملف PDF فقط.');
  }
  if (file.size > 40 * 1024 * 1024) {
    throw new Error('حجم الملف أكبر من 40 ميغابايت. جرّب ضغط المحاضرة أو تقسيمها.');
  }
  const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > 800) {
    await pdf.destroy();
    throw new Error('المحاضرة تتجاوز 800 صفحة. قسّم الملف إلى أجزاء أصغر لتقليل استهلاك ذاكرة الهاتف.');
  }
  const pages: PageText[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ page: pageNumber, text });
  }
  if (!pages.some((page) => page.text.length > 0)) {
    throw new Error('الملف لا يحتوي نصًا قابلًا للاستخراج. قد يكون ملفًا ممسوحًا ضوئيًا.');
  }
  return pages;
}
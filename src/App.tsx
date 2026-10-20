import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowRight, BookOpen, BrainCircuit, CheckCircle2, ChevronLeft,
  FileText, FileUp, GraduationCap, Home, Library, Loader2, MessageCircle,
  Send, Sparkles, Trash2, WifiOff, X
} from 'lucide-react';
import { extractPdf } from './lib/pdf';
import { runTutor, type TutorAction, type TutorResponse } from './lib/ai';
import { listMaterials, listQuizzes, removeMaterial, saveMaterial, saveQuiz } from './lib/storage';
import type { Material, QuizQuestion, SavedQuiz } from './types';

type View = 'home' | 'library' | 'study' | 'quiz';

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function App() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [quizzes, setQuizzes] = useState<SavedQuiz[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<View>('home');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<TutorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [graded, setGraded] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => materials.find((material) => material.id === selectedId) ?? null, [materials, selectedId]);

  async function refreshLocalData() {
    const [savedMaterials, savedQuizzes] = await Promise.all([listMaterials(), listQuizzes()]);
    setMaterials(savedMaterials);
    setQuizzes(savedQuizzes);
    setSelectedId((current) => current || savedMaterials[0]?.id || '');
  }

  useEffect(() => {
    refreshLocalData().catch(() => setError('تعذر فتح المكتبة المحلية. افحص مساحة التخزين في المتصفح.'));
  }, []);

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    setBusy(true);
    setBusyText('نقرأ صفحات المحاضرة...');
    try {
      const pages = await extractPdf(file);
      const material: Material = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        addedAt: Date.now(),
        pages,
        file
      };
      await saveMaterial(material);
      setMaterials((current) => [material, ...current]);
      setSelectedId(material.id);
      setResult(null);
      setView('study');
      setNotice('أُضيفت المحاضرة إلى مكتبتك على هذا الجهاز.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذّر قراءة الملف.');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  async function deleteMaterial(material: Material) {
    const confirmed = window.confirm('حذف "' + material.name + '" وكل اختبار مرتبط بها من هذا الجهاز؟');
    if (!confirmed) return;
    await removeMaterial(material.id);
    const remaining = materials.filter((item) => item.id !== material.id);
    setMaterials(remaining);
    setQuizzes((current) => current.filter((quiz) => quiz.materialId !== material.id));
    if (selectedId === material.id) {
      setSelectedId(remaining[0]?.id || '');
      setResult(null);
    }
    setNotice('حُذفت المحاضرة والاختبارات المرتبطة بها.');
  }

  async function ask(action: TutorAction) {
    if (!selected) {
      setError('ارفع محاضرة PDF أولًا.');
      return;
    }
    if (action === 'ask' && !question.trim()) {
      setError('اكتب سؤالك عن المحاضرة أولًا.');
      return;
    }
    setBusy(true);
    setBusyText(action === 'quiz' ? 'نجهّز أسئلة من المحاضرة...' : action === 'summary' ? 'نلخّص المحاضرة...' : 'نبحث عن إجابة من صفحات المحاضرة...');
    setError('');
    setNotice('');
    setResult(null);
    try {
      const response = await runTutor(selected, action, question.trim());
      setResult(response);
      if (action === 'quiz' && response.questions?.length) {
        const quiz: SavedQuiz = {
          id: crypto.randomUUID(),
          materialId: selected.id,
          title: 'اختبار: ' + selected.name,
          questions: response.questions,
          answers: Array(response.questions.length).fill(-1),
          score: 0,
          createdAt: Date.now()
        };
        await saveQuiz(quiz);
        setQuizzes((current) => [quiz, ...current]);
        setActiveQuiz(quiz);
        setAnswers(quiz.answers);
        setGraded(false);
        setView('quiz');
      } else {
        window.setTimeout(() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذّر تنفيذ الطلب.');
    } finally {
      setBusy(false);
      setBusyText('');
    }
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask('ask');
  }

  function openQuiz(quiz: SavedQuiz) {
    setActiveQuiz(quiz);
    setAnswers(quiz.answers?.length === quiz.questions.length ? [...quiz.answers] : Array(quiz.questions.length).fill(-1));
    setGraded(false);
    setView('quiz');
  }

  async function gradeQuiz() {
    if (!activeQuiz) return;
    const score = activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0);
    const updated: SavedQuiz = { ...activeQuiz, answers: [...answers], score };
    await saveQuiz(updated);
    setActiveQuiz(updated);
    setQuizzes((current) => current.map((quiz) => quiz.id === updated.id ? updated : quiz));
    setGraded(true);
  }

  function jumpToPage(page: number) {
    setView('study');
    window.setTimeout(() => document.getElementById('page-' + page)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setView('home'); }}>
          <span className="brand-mark"><GraduationCap size={25} /></span>
          <span><strong>Hema Uni</strong><small>هيما الجامعي</small></span>
        </a>
        <div className="side-label">مساحة الدراسة</div>
        <nav className="side-nav" aria-label="التنقل الرئيسي">
          <button className={view === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setView('home')}><Home size={18} /> الرئيسية</button>
          <button className={view === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setView('library')}><Library size={18} /> مكتبتي <span className="nav-count">{materials.length}</span></button>
          <button className={view === 'study' ? 'nav-item active' : 'nav-item'} onClick={() => { if (selected) setView('study'); else setView('library'); }}><MessageCircle size={18} /> مدرس المحاضرة</button>
          <button className={view === 'quiz' ? 'nav-item active' : 'nav-item'} onClick={() => quizzes[0] ? openQuiz(quizzes[0]) : setView('library')}><BookOpen size={18} /> اختباراتي <span className="nav-count">{quizzes.length}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-note"><WifiOff size={17} /><span><strong>مكتبتك محلية</strong><small>ملفاتك محفوظة على جهازك</small></span></div>
          <p className="sidebar-disclaimer">مبادرة طلابية مستقلة، وليست منصة رسمية للجامعة.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Hema Uni</span><ChevronLeft size={15} /><strong>{view === 'home' ? 'الرئيسية' : view === 'library' ? 'مكتبتي' : view === 'quiz' ? 'اختباراتي' : 'مدرس المحاضرة'}</strong></div>
          <button className="top-upload" onClick={() => uploadRef.current?.click()}><FileUp size={17} /> رفع محاضرة</button>
          <input ref={uploadRef} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={onUpload} />
        </header>

        {(error || notice || busy) && <div className={error ? 'feedback error' : 'feedback'} role="status">
          {error ? <AlertCircle size={18} /> : busy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || busyText || notice}</span>
          {error && <button aria-label="إغلاق التنبيه" onClick={() => setError('')}><X size={16} /></button>}
          {!error && !busy && <button aria-label="إغلاق التنبيه" onClick={() => setNotice('')}><X size={16} /></button>}
        </div>}

        {view === 'home' && <section className="page">
          <div className="welcome">
            <div>
              <div className="eyebrow"><Sparkles size={15} /> مساحتك للفهم والتعلّم</div>
              <h1>خلّينا نفهمها <span>مع بعض.</span></h1>
              <p>ارفع محاضرتك، اسأل عن الجزء الصعب، وتدرّب قبل الامتحان.</p>
              <button className="primary-btn" onClick={() => uploadRef.current?.click()}><FileUp size={18} /> ابدأ بمحاضرة PDF <ArrowRight size={17} /></button>
            </div>
            <div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div><div className="art-core"><BrainCircuit size={52} /></div><span className="art-dot dot-one"></span><span className="art-dot dot-two"></span><span className="art-dot dot-three"></span></div>
          </div>

          <div className="stat-grid">
            <div className="stat-card"><span className="stat-icon purple"><FileText size={19} /></span><div><small>المحاضرات</small><strong>{materials.length}</strong></div></div>
            <div className="stat-card"><span className="stat-icon teal"><BrainCircuit size={19} /></span><div><small>صفحات مستخرجة</small><strong>{materials.reduce((sum, item) => sum + item.pages.length, 0)}</strong></div></div>
            <div className="stat-card"><span className="stat-icon blue"><BookOpen size={19} /></span><div><small>الاختبارات</small><strong>{quizzes.length}</strong></div></div>
          </div>

          <div className="section-heading"><div><h2>ابدأ من هنا</h2><p>أدواتك الأساسية للمذاكرة</p></div></div>
          <div className="action-grid">
            <button className="action-card" onClick={() => uploadRef.current?.click()}><span className="action-icon purple"><FileUp size={22} /></span><strong>أضف محاضرة</strong><small>استخرج نص PDF واحفظه بمكتبتك</small><span className="card-link">رفع ملف <ChevronLeft size={15} /></span></button>
            <button className="action-card" onClick={() => selected ? setView('study') : setView('library')}><span className="action-icon teal"><MessageCircle size={22} /></span><strong>اسأل المدرّس</strong><small>شرح مرتبط بصفحات محاضرتك</small><span className="card-link">ابدأ السؤال <ChevronLeft size={15} /></span></button>
            <button className="action-card" onClick={() => selected ? void ask('quiz') : setView('library')}><span className="action-icon blue"><BookOpen size={22} /></span><strong>اختبر نفسك</strong><small>أنشئ اختبارًا قصيرًا من المادة</small><span className="card-link">إنشاء اختبار <ChevronLeft size={15} /></span></button>
          </div>

          <div className="section-heading recent-heading"><div><h2>آخر محاضراتك</h2><p>تُحفظ على هذا الجهاز</p></div><button className="text-btn" onClick={() => setView('library')}>عرض المكتبة <ChevronLeft size={15} /></button></div>
          {materials.length ? <MaterialList materials={materials.slice(0, 4)} onOpen={(item) => { setSelectedId(item.id); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
        </section>}

        {view === 'library' && <section className="page">
          <div className="page-intro"><span className="eyebrow">محتواك الدراسي</span><h1>مكتبتي</h1><p>ملفات محاضراتك محفوظة محليًا. لا تُرسل للمساعد إلا المقاطع اللازمة عند طلب الشرح.</p></div>
          <div className="library-toolbar"><span>{materials.length} محاضرة محفوظة</span><button className="primary-btn small" onClick={() => uploadRef.current?.click()}><FileUp size={17} /> أضف PDF</button></div>
          {materials.length ? <MaterialList materials={materials} onOpen={(item) => { setSelectedId(item.id); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
          <div className="saved-quizzes"><div className="section-heading"><div><h2>اختبارات محفوظة</h2><p>ارجع لتدريب سابق</p></div></div>
            {quizzes.length ? quizzes.map((quiz) => <button className="quiz-row" key={quiz.id} onClick={() => openQuiz(quiz)}><span className="quiz-row-icon"><BookOpen size={19} /></span><span className="quiz-row-info"><strong>{quiz.title}</strong><small>{quiz.questions.length} أسئلة · {new Date(quiz.createdAt).toLocaleDateString('ar')}</small></span><ChevronLeft size={18} /></button>) : <p className="muted-text">لم تنشئ اختبارات بعد.</p>}
          </div>
        </section>}

        {view === 'study' && <section className="page study-page">
          {!selected ? <EmptyState onUpload={() => uploadRef.current?.click()} /> : <>
            <div className="page-intro study-intro"><span className="eyebrow"><BrainCircuit size={15} /> المدرّس الذكي</span><h1>{selected.name}</h1><p>{selected.pages.length} صفحة · {formatSize(selected.size)} · النص والمراجع محفوظة على جهازك</p></div>
            <div className="tutor-layout">
              <div className="tutor-panel">
                <div className="panel-head"><span className="assistant-avatar"><BrainCircuit size={20} /></span><div><strong>اسأل محاضرتك</strong><small>إجابات مستندة إلى الصفحات المتاحة</small></div><span className="online-dot"></span></div>
                <div className="starter-prompts"><button onClick={() => { setQuestion('اشرح أهم فكرة في هذه المحاضرة بطريقة سهلة مع مثال.'); }}>اشرح أهم فكرة</button><button onClick={() => void ask('summary')}>لخّص المحاضرة</button><button onClick={() => void ask('quiz')}>أنشئ اختبارًا</button></div>
                <form className="question-form" onSubmit={submitQuestion}>
                  <label htmlFor="question">شو حابب تفهم؟</label>
                  <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="مثال: اشرح لي مفهومًا صعبًا في الصفحة 5..." rows={3} maxLength={1500} />
                  <div className="form-foot"><span>{question.length}/1500</span><button className="primary-btn small" disabled={busy || !question.trim()} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />} اسأل المدرّس</button></div>
                </form>
                <p className="privacy-note"><AlertCircle size={14} /> عند استخدام AI، تُرسل مقتطفات من الصفحات المختارة إلى مزود الخدمة عبر الخادم.</p>
                {result && <div className="answer-box" ref={chatRef}>
                  <div className="answer-title"><Sparkles size={17} /><strong>{result.model ? 'إجابة المساعد' : 'النتيجة'}</strong></div>
                  <div className="answer-text">{result.text}</div>
                  {!!result.citations?.length && <div className="citations"><strong>المصادر من المحاضرة</strong>{result.citations.map((citation, index) => <button className="citation-chip" key={citation.page + '-' + index} onClick={() => jumpToPage(citation.page)}><FileText size={14} /> صفحة {citation.page}{citation.quote ? ' — ' + citation.quote.slice(0, 70) : ''}</button>)}</div>}
                </div>}
              </div>
              <div className="pages-panel">
                <div className="panel-head"><span className="pages-icon"><FileText size={19} /></span><div><strong>نص المحاضرة</strong><small>تقدر ترجع للمصدر بأي وقت</small></div></div>
                <div className="page-list">{selected.pages.map((page) => <article className="page-snippet" id={'page-' + page.page} key={page.page}><div className="page-snippet-head"><strong>صفحة {page.page}</strong><button onClick={() => { setQuestion('اشرح محتوى الصفحة ' + page.page + ' مع مثال.'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>اسأل عنها <ChevronLeft size={13} /></button></div><p>{page.text || 'لم يُستخرج نص من هذه الصفحة.'}</p></article>)}</div>
              </div>
            </div>
          </>}
        </section>}

        {view === 'quiz' && <section className="page">
          {!activeQuiz ? <EmptyState onUpload={() => setView('library')} /> : <div className="quiz-screen">
            <button className="back-link" onClick={() => setView('library')}><ArrowRight size={16} /> العودة للمكتبة</button>
            <div className="page-intro"><span className="eyebrow"><BookOpen size={15} /> تدريب قصير</span><h1>{activeQuiz.title}</h1><p>{activeQuiz.questions.length} أسئلة من المحاضرة. اختر إجابة لكل سؤال ثم اضغط تصحيح.</p></div>
            {graded && <div className="score-card"><span className="score-number">{activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0)}/{activeQuiz.questions.length}</span><div><strong>نتيجتك</strong><small>{activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0) === activeQuiz.questions.length ? 'ممتاز! أجبت عن كل الأسئلة بشكل صحيح.' : 'راجع التفسيرات وحاول مرة ثانية.'}</small></div></div>}
            {activeQuiz.questions.map((item, index) => <QuestionCard key={activeQuiz.id + '-' + index} item={item} index={index} answer={answers[index] ?? -1} graded={graded} onAnswer={(value) => setAnswers((current) => current.map((answer, i) => i === index ? value : answer))} onPage={jumpToPage} />)}
            <div className="quiz-bottom"><button className="primary-btn" onClick={() => graded ? (setAnswers(Array(activeQuiz.questions.length).fill(-1)), setGraded(false)) : void gradeQuiz()}>{graded ? 'أعد الاختبار' : 'تصحيح الإجابات'} <ArrowRight size={16} /></button></div>
          </div>}
        </section>}

        <footer className="app-footer"><span>Hema Uni · إصدار تجريبي</span><span>التعلّم خطوة بخطوة</span></footer>
      </main>
    </div>
  );
}

function MaterialList({ materials, onOpen, onDelete }: { materials: Material[]; onOpen: (item: Material) => void; onDelete: (item: Material) => void }) {
  return <div className="material-list">{materials.map((material) => <div className="material-row" key={material.id}>
    <div className="material-icon"><FileText size={22} /></div>
    <button className="material-info" onClick={() => onOpen(material)}><strong>{material.name}</strong><small>{material.pages.length} صفحة · {formatSize(material.size)} · أُضيف {new Date(material.addedAt).toLocaleDateString('ar')}</small></button>
    <button className="icon-btn open-btn" title="فتح المحاضرة" onClick={() => onOpen(material)}><ChevronLeft size={19} /></button>
    <button className="icon-btn delete-btn" title="حذف المحاضرة" onClick={() => onDelete(material)}><Trash2 size={17} /></button>
  </div>)}</div>;
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><FileUp size={29} /></span><h3>مكتبتك لسه فاضية</h3><p>أضف أول محاضرة PDF عشان تبدأ التلخيص والشرح والاختبارات.</p><button className="primary-btn" onClick={onUpload}><FileUp size={17} /> ارفع محاضرة</button></div>;
}

function QuestionCard({ item, index, answer, graded, onAnswer, onPage }: { item: QuizQuestion; index: number; answer: number; graded: boolean; onAnswer: (value: number) => void; onPage: (page: number) => void }) {
  return <article className="question-card">
    <div className="question-meta"><span>سؤال {index + 1}</span>{item.page && <button onClick={() => onPage(item.page!)}>صفحة {item.page} <ChevronLeft size={13} /></button>}</div>
    <h3>{item.question}</h3>
    <div className="choices">{item.choices.map((choice, choiceIndex) => <label className={'choice' + (answer === choiceIndex ? ' selected' : '') + (graded && choiceIndex === item.correctIndex ? ' correct' : '') + (graded && answer === choiceIndex && answer !== item.correctIndex ? ' wrong' : '')} key={choiceIndex}>
      <input type="radio" name={'question-' + index} checked={answer === choiceIndex} onChange={() => !graded && onAnswer(choiceIndex)} disabled={graded} />
      <span className="choice-letter">{String.fromCharCode(65 + choiceIndex)}</span><span>{choice}</span>
      {graded && choiceIndex === item.correctIndex && <CheckCircle2 size={17} className="choice-status" />}
    </label>)}</div>
    {graded && <div className="explanation"><strong>التفسير:</strong> {item.explanation || 'راجع الصفحة المشار إليها في المحاضرة.'}</div>}
  </article>;
}
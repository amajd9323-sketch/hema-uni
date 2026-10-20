import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertCircle, ArrowRight, BookOpen, BrainCircuit, CheckCircle2, ChevronLeft,
  FileText, FileUp, GraduationCap, Home, Library, Loader2, MessageCircle,
  Send, Sparkles, Trash2, WifiOff, X, Mic, Bookmark, RotateCcw, Settings, Clock3
} from 'lucide-react';
import { extractPdf } from './lib/pdf';
import { runTutor, type TutorAction, type TutorResponse, type TutorDifficulty } from './lib/ai';
import { listMaterials, listQuizzes, listFlashcardSets, removeMaterial, saveMaterial, saveQuiz, saveFlashcardSet, removeFlashcardSet } from './lib/storage';
import type { Material, QuizQuestion, SavedQuiz, SavedFlashcardSet } from './types';
import { getDocument } from 'pdfjs-dist';

type View = 'home' | 'library' | 'study' | 'quiz' | 'flashcards' | 'settings';
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

type PDFDocument = Awaited<ReturnType<typeof getDocument>['promise']>;

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
  const [flashcardSets, setFlashcardSets] = useState<SavedFlashcardSet[]>([]);
  const [activeFlashcards, setActiveFlashcards] = useState<SavedFlashcardSet | null>(null);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardRevealed, setFlashcardRevealed] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [selectedPage, setSelectedPage] = useState<number | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState<TutorDifficulty>('medium');
  const [examDuration, setExamDuration] = useState(15);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [examMode, setExamMode] = useState(true);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [fontScale, setFontScale] = useState(100);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => materials.find((material) => material.id === selectedId) ?? null, [materials, selectedId]);

  async function refreshLocalData() {
    const [savedMaterials, savedQuizzes, savedFlashcards] = await Promise.all([listMaterials(), listQuizzes(), listFlashcardSets()]);
    setMaterials(savedMaterials);
    setQuizzes(savedQuizzes);
    setFlashcardSets(savedFlashcards);
    setSelectedId((current) => savedMaterials.some((material) => material.id === current) ? current : savedMaterials[0]?.id || '');
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

  async function ask(action: TutorAction, focusText?: string, focusPage?: number) {
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
      const response = await runTutor(selected, action, question.trim(), {
        selectedText: action === 'explain' ? (focusText || selectedText) : undefined,
        selectedPage: action === 'explain' ? (focusPage || selectedPage) : undefined,
        questionCount,
        difficulty
      });
      setResult(response);
      if (action === 'flashcards' && response.flashcards?.length) {
        const set: SavedFlashcardSet = {
          id: crypto.randomUUID(),
          materialId: selected.id,
          title: 'بطاقات: ' + selected.name,
          cards: response.flashcards,
          createdAt: Date.now()
        };
        await saveFlashcardSet(set);
        setFlashcardSets((current) => [set, ...current]);
        setActiveFlashcards(set);
        setFlashcardIndex(0);
        setFlashcardRevealed(false);
        setView('flashcards');
      } else if (action === 'quiz' && response.questions?.length) {
        const quiz: SavedQuiz = {
          id: crypto.randomUUID(),
          materialId: selected.id,
          title: 'اختبار: ' + selected.name,
          questions: response.questions,
          answers: Array(response.questions.length).fill(-1),
          score: 0,
          createdAt: Date.now(),
          durationMinutes: examDuration,
          difficulty
        };
        await saveQuiz(quiz);
        setQuizzes((current) => [quiz, ...current]);
        setActiveQuiz(quiz);
        setAnswers(quiz.answers);
        setGraded(false);
        setQuestionIndex(0);
        setTimeRemaining(examDuration * 60);
        setTimerActive(examDuration > 0);
        setExamMode(true);
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
    setAnswers(Array(quiz.questions.length).fill(-1));
    setGraded(false);
    setQuestionIndex(0);
    setTimeRemaining((quiz.durationMinutes || 0) * 60);
    setTimerActive(Boolean(quiz.durationMinutes));
    setExamMode(true);
    setView('quiz');
  }

  function openFlashcards(set: SavedFlashcardSet) {
    setActiveFlashcards(set);
    setFlashcardIndex(0);
    setFlashcardRevealed(false);
    setView('flashcards');
  }

  async function deleteFlashcardSet(set: SavedFlashcardSet) {
    if (!window.confirm('حذف مجموعة البطاقات من هذا الجهاز؟')) return;
    await removeFlashcardSet(set.id);
    setFlashcardSets((current) => current.filter((item) => item.id !== set.id));
    if (activeFlashcards?.id === set.id) setActiveFlashcards(null);
    setNotice('حُذفت مجموعة البطاقات.');
  }

  function startVoiceInput() {
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('الإملاء الصوتي غير مدعوم في هذا المتصفح. جرّب Chrome على الهاتف أو استخدم لوحة المفاتيح الصوتية.');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ar';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim();
        if (transcript) setQuestion((current) => current ? current + ' ' + transcript : transcript);
      };
      recognition.onerror = () => {
        setListening(false);
        setError('تعذر التقاط الصوت. تأكد من إذن الميكروفون ثم حاول مجددًا.');
      };
      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setError('');
    } catch {
      setListening(false);
      setError('تعذر بدء الإملاء الصوتي.');
    }
  }

  async function gradeQuiz() {
    if (!activeQuiz || graded) return;
    const score = activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0);
    const updated: SavedQuiz = { ...activeQuiz, answers: [...answers], score, completedAt: Date.now() };
    await saveQuiz(updated);
    setActiveQuiz(updated);
    setQuizzes((current) => current.map((quiz) => quiz.id === updated.id ? updated : quiz));
    setGraded(true);
    setTimerActive(false);
  }

  function jumpToPage(page: number) {
    setSelectedPage(page);
    setView('study');
    window.setTimeout(() => document.getElementById('page-' + page)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  useEffect(() => {
    if (!timerActive || view !== 'quiz' || graded) return;
    if (timeRemaining <= 0) {
      setTimerActive(false);
      void gradeQuiz();
      setNotice('انتهى وقت الاختبار؛ حُفظت نتيجتك.');
      return;
    }
    const timer = window.setTimeout(() => setTimeRemaining((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [timerActive, view, graded, timeRemaining, activeQuiz, answers]);

  useEffect(() => {
    document.documentElement.style.setProperty('--study-font-scale', String(fontScale / 100));
    return () => document.documentElement.style.removeProperty('--study-font-scale');
  }, [fontScale]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
  }, []);

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
          <button className={view === 'quiz' ? 'nav-item active' : 'nav-item'} onClick={() => quizzes[0] ? openQuiz(quizzes[0]) : setView('library')}><BookOpen size={18} /> الامتحانات <span className="nav-count">{quizzes.length}</span></button>
          <button className={view === 'flashcards' ? 'nav-item active' : 'nav-item'} onClick={() => setView('flashcards')}><Bookmark size={18} /> بطاقات الحفظ <span className="nav-count">{flashcardSets.length}</span></button>
          <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('settings')}><Settings size={18} /> الإعدادات</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-note"><WifiOff size={17} /><span><strong>مكتبتك محلية</strong><small>ملفاتك محفوظة على جهازك</small></span></div>
          <p className="sidebar-disclaimer">مبادرة طلابية مستقلة، وليست منصة رسمية للجامعة.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Hema Uni</span><ChevronLeft size={15} /><strong>{({ home: 'الرئيسية', library: 'مكتبتي', quiz: 'الامتحانات', study: 'مدرس المحاضرة', flashcards: 'بطاقات الحفظ', settings: 'الإعدادات' } as Record<View, string>)[view]}</strong></div>
          <div className="topbar-actions"><button className="icon-btn" title="الإعدادات" aria-label="الإعدادات" onClick={() => setView('settings')}><Settings size={17} /></button><button className="top-upload" onClick={() => uploadRef.current?.click()}><FileUp size={17} /> رفع محاضرة</button></div>
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
            <button className="action-card" onClick={() => selected ? void ask('quiz') : setView('library')}><span className="action-icon blue"><BookOpen size={22} /></span><strong>اختبر نفسك</strong><small>إنشاء امتحان مؤقت مع تصحيح ونتيجة</small><span className="card-link">إنشاء امتحان <ChevronLeft size={15} /></span></button>
            <button className="action-card" onClick={() => selected ? void ask('flashcards') : setView('library')}><span className="action-icon purple"><Bookmark size={22} /></span><strong>بطاقات الحفظ</strong><small>حوّل المفاهيم والتعاريف إلى بطاقات مراجعة</small><span className="card-link">إنشاء بطاقات <ChevronLeft size={15} /></span></button>
          </div>

          <div className="section-heading recent-heading"><div><h2>آخر محاضراتك</h2><p>تُحفظ على هذا الجهاز</p></div><button className="text-btn" onClick={() => setView('library')}>عرض المكتبة <ChevronLeft size={15} /></button></div>
          {materials.length ? <MaterialList materials={materials.slice(0, 4)} onOpen={(item) => { setSelectedId(item.id); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
        </section>}

        {view === 'library' && <section className="page">
          <div className="page-intro"><span className="eyebrow">محتواك الدراسي</span><h1>مكتبتي</h1><p>ملفات محاضراتك محفوظة محليًا. لا تُرسل للمساعد إلا المقاطع اللازمة عند طلب الشرح.</p></div>
          <div className="library-toolbar"><span>{materials.length} محاضرة محفوظة</span><button className="primary-btn small" onClick={() => uploadRef.current?.click()}><FileUp size={17} /> أضف PDF</button></div>
          {materials.length ? <MaterialList materials={materials} onOpen={(item) => { setSelectedId(item.id); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
          <div className="saved-quizzes"><div className="section-heading"><div><h2>اختبارات محفوظة</h2><p>تدريبات مؤقتة أو عادية من محاضراتك</p></div></div>
            {quizzes.length ? quizzes.map((quiz) => <button className="quiz-row" key={quiz.id} onClick={() => openQuiz(quiz)}><span className="quiz-row-icon"><BookOpen size={19} /></span><span className="quiz-row-info"><strong>{quiz.title}</strong><small>{quiz.questions.length} سؤال · {quiz.durationMinutes ? quiz.durationMinutes + ' دقيقة' : 'دون مؤقت'} · {new Date(quiz.createdAt).toLocaleDateString('ar')}</small></span><ChevronLeft size={18} /></button>) : <p className="muted-text">لم تنشئ اختبارات بعد.</p>}
          </div>
          <div className="saved-quizzes"><div className="section-heading"><div><h2>بطاقات الحفظ</h2><p>راجع المصطلحات والتعاريف بسرعة</p></div><button className="text-btn" onClick={() => setView('flashcards')}>عرض الكل <ChevronLeft size={15} /></button></div>
            {flashcardSets.length ? flashcardSets.slice(0, 3).map((set) => <button className="quiz-row" key={set.id} onClick={() => openFlashcards(set)}><span className="quiz-row-icon"><Bookmark size={19} /></span><span className="quiz-row-info"><strong>{set.title}</strong><small>{set.cards.length} بطاقة · {new Date(set.createdAt).toLocaleDateString('ar')}</small></span><ChevronLeft size={18} /></button>) : <p className="muted-text">لم تنشئ بطاقات بعد.</p>}
          </div>
        </section>}

        {view === 'study' && <section className="page study-page">
          {!selected ? <EmptyState onUpload={() => uploadRef.current?.click()} /> : <>
            <div className="page-intro study-intro"><span className="eyebrow"><BrainCircuit size={15} /> المدرّس الذكي</span><h1>{selected.name}</h1><p>{selected.pages.length} صفحة · {formatSize(selected.size)} · النص والمراجع محفوظة على جهازك</p></div>
            <PdfReader file={selected.file} />
            <div className="tutor-layout">
              <div className="tutor-panel">
                <div className="panel-head"><span className="assistant-avatar"><BrainCircuit size={20} /></span><div><strong>اسأل محاضرتك</strong><small>إجابات مستندة إلى الصفحات المتاحة</small></div><span className="online-dot"></span></div>
                <div className="starter-prompts"><button onClick={() => { setQuestion('اشرح أهم فكرة في هذه المحاضرة بطريقة سهلة مع مثال.'); }}>اشرح أهم فكرة</button><button onClick={() => void ask('summary')}>لخّص المحاضرة</button><button onClick={() => void ask('quiz')}>أنشئ اختبارًا</button><button onClick={() => void ask('flashcards')}>بطاقات حفظ</button>{selectedText && <button onClick={() => void ask('explain', selectedText, selectedPage)}>اشرح النص المحدد</button>}</div>
                <form className="question-form" onSubmit={submitQuestion}>
                  <label htmlFor="question">شو حابب تفهم؟</label>
                  <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="اكتب سؤالك أو استخدم الميكروفون..." rows={3} maxLength={1500} />
                  <div className="form-foot"><span>{question.length}/1500</span><div className="form-buttons"><button className={listening ? 'icon-btn listening' : 'icon-btn'} type="button" title="اسأل بصوتك" aria-label="اسأل بصوتك" onClick={startVoiceInput}><Mic size={17} /></button><button className="primary-btn small" disabled={busy || (!question.trim() && !selectedText)} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />} اسأل المدرّس</button></div></div>
                </form>
                {selectedText && <div className="selected-text-box"><div><strong>النص المحدد — صفحة {selectedPage}</strong><button aria-label="مسح النص المحدد" onClick={() => { setSelectedText(''); setSelectedPage(undefined); }}><X size={14} /></button></div><p>{selectedText.slice(0, 360)}{selectedText.length > 360 ? '…' : ''}</p><button className="primary-btn small" onClick={() => void ask('explain', selectedText, selectedPage)}>اشرح المقطع المحدد <Sparkles size={15} /></button></div>}
                <p className="privacy-note"><AlertCircle size={14} /> عند استخدام AI، تُرسل مقتطفات من الصفحات المختارة إلى مزود الخدمة عبر الخادم.</p>
                {result && <div className="answer-box" ref={chatRef}>
                  <div className="answer-title"><Sparkles size={17} /><strong>{result.model ? 'إجابة المساعد' : 'النتيجة'}</strong></div>
                  <div className="answer-text">{result.text}</div>
                  {!!result.citations?.length && <div className="citations"><strong>المصادر من المحاضرة</strong>{result.citations.map((citation, index) => <button className="citation-chip" key={citation.page + '-' + index} onClick={() => jumpToPage(citation.page)}><FileText size={14} /> صفحة {citation.page}{citation.quote ? ' — ' + citation.quote.slice(0, 70) : ''}</button>)}</div>}
                </div>}
              </div>
              <div className="pages-panel">
                <div className="panel-head"><span className="pages-icon"><FileText size={19} /></span><div><strong>نص المحاضرة</strong><small>تقدر ترجع للمصدر بأي وقت</small></div></div>
                <div className="page-list">{selected.pages.map((page) => <article className="page-snippet" id={'page-' + page.page} key={page.page} onMouseUp={() => { const text = window.getSelection()?.toString().trim() || ''; if (text.length > 5) { setSelectedText(text.slice(0, 5000)); setSelectedPage(page.page); } }}><div className="page-snippet-head"><strong>صفحة {page.page}</strong><button onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuestion('اشرح محتوى الصفحة ' + page.page + ' مع مثال.'); setSelectedPage(page.page); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>اسأل عنها <ChevronLeft size={13} /></button></div><p>{page.text || 'لم يُستخرج نص من هذه الصفحة.'}</p><button className="page-explain-button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const text = window.getSelection()?.toString().trim(); const focus = text && text.length > 5 ? text.slice(0, 5000) : page.text.slice(0, 5000); setSelectedText(focus); setSelectedPage(page.page); void ask('explain', focus, page.page); }}>اشرح نص الصفحة <Sparkles size={13} /></button></article>)}</div>
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

        <nav className="mobile-nav" aria-label="التنقل الرئيسي للهاتف">
          <button className={view === 'home' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('home')}><Home size={19} /><span>الرئيسية</span></button>
          <button className={view === 'library' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('library')}><Library size={19} /><span>مكتبتي</span></button>
          <button className={view === 'study' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => selected ? setView('study') : setView('library')}><MessageCircle size={19} /><span>المساعد</span></button>
          <button className={view === 'quiz' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => quizzes[0] ? openQuiz(quizzes[0]) : setView('library')}><BookOpen size={19} /><span>الامتحانات</span></button>
          <button className={view === 'flashcards' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('flashcards')}><Bookmark size={19} /><span>بطاقات</span></button>
        </nav>
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
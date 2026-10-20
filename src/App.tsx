import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import {
  AlertCircle, ArrowRight, BookOpen, BrainCircuit, CheckCircle2, ChevronLeft,
  FileText, FileUp, GraduationCap, Home, Library, Loader2, MessageCircle,
  Send, Sparkles, Trash2, WifiOff, X, Mic, Bookmark, RotateCcw, Settings, Clock3
} from 'lucide-react';
import { extractPdf } from './lib/pdf';
import { runTutor, type TutorAction, type TutorResponse, type TutorDifficulty } from './lib/ai';
import { listMaterials, listQuizzes, listFlashcardSets, listStudyNotes, removeMaterial, saveMaterial, saveQuiz, saveFlashcardSet, removeFlashcardSet, saveStudyNote, removeStudyNote } from './lib/storage';
import type { Material, QuizQuestion, SavedQuiz, SavedFlashcardSet, StudyNote } from './types';
import { getDocument } from 'pdfjs-dist';

type View = 'home' | 'library' | 'study' | 'quiz' | 'flashcards' | 'notes' | 'settings';
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
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [activeFlashcards, setActiveFlashcards] = useState<SavedFlashcardSet | null>(null);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardRevealed, setFlashcardRevealed] = useState(false);
  const [reviewDueOnly, setReviewDueOnly] = useState(false);
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
  const visibleFlashcards = useMemo(() => activeFlashcards
    ? activeFlashcards.cards.map((card, originalIndex) => ({ card, originalIndex }))
      .filter(({ card }) => !reviewDueOnly || !card.dueAt || card.dueAt <= Date.now())
    : [], [activeFlashcards, reviewDueOnly]);
  const currentFlashcardEntry = visibleFlashcards[flashcardIndex] ?? null;
  const currentFlashcard = currentFlashcardEntry?.card ?? null;

  async function refreshLocalData() {
    const [savedMaterials, savedQuizzes, savedFlashcards, savedNotes] = await Promise.all([listMaterials(), listQuizzes(), listFlashcardSets(), listStudyNotes()]);
    setMaterials(savedMaterials);
    setQuizzes(savedQuizzes);
    setFlashcardSets(savedFlashcards);
    setNotes(savedNotes);
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
      setSelectedText('');
      setSelectedPage(undefined);
      setQuestion('');
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
    if (activeQuiz?.materialId === material.id) { setActiveQuiz(null); setGraded(false); setTimerActive(false); }
    setFlashcardSets((current) => current.filter((set) => set.materialId !== material.id));
    setNotes((current) => current.filter((note) => note.materialId !== material.id));
    if (activeFlashcards?.materialId === material.id) setActiveFlashcards(null);
    if (selectedId === material.id) {
      setSelectedId(remaining[0]?.id || '');
      setSelectedText('');
      setSelectedPage(undefined);
      setQuestion('');
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
        selectedPage: focusPage || selectedPage,
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
    const isCompleted = Boolean(quiz.completedAt);
    setSelectedId(quiz.materialId);
    setActiveQuiz(quiz);
    setAnswers(isCompleted && quiz.answers?.length === quiz.questions.length ? [...quiz.answers] : Array(quiz.questions.length).fill(-1));
    setGraded(isCompleted);
    setQuestionIndex(0);
    setTimeRemaining((quiz.durationMinutes || 0) * 60);
    setTimerActive(Boolean(quiz.durationMinutes) && !isCompleted);
    setExamMode(true);
    setView('quiz');
  }

  function openFlashcards(set: SavedFlashcardSet) {
    setSelectedId(set.materialId);
    setActiveFlashcards(set);
    setFlashcardIndex(0);
    setFlashcardRevealed(false);
    setReviewDueOnly(false);
    setView('flashcards');
  }

  async function deleteFlashcardSet(set: SavedFlashcardSet) {
    if (!window.confirm('حذف مجموعة البطاقات من هذا الجهاز؟')) return;
    await removeFlashcardSet(set.id);
    setFlashcardSets((current) => current.filter((item) => item.id !== set.id));
    if (activeFlashcards?.id === set.id) setActiveFlashcards(null);
    setNotice('حُذفت مجموعة البطاقات.');
  }

  async function saveCurrentNote(text = selectedText, page = selectedPage) {
    if (!selected || !text.trim()) {
      setError('حدد نصًا من المحاضرة أولًا، ثم احفظه في الدفتر.');
      return;
    }
    const note: StudyNote = {
      id: crypto.randomUUID(),
      materialId: selected.id,
      materialName: selected.name,
      page: page || 1,
      text: text.trim().slice(0, 5000),
      createdAt: Date.now()
    };
    await saveStudyNote(note);
    setNotes((current) => [note, ...current]);
    setNotice('حُفظ المقتطف في دفتر الملاحظات على هذا الجهاز.');
  }

  async function deleteNote(note: StudyNote) {
    await removeStudyNote(note.id);
    setNotes((current) => current.filter((item) => item.id !== note.id));
    setNotice('حُذفت الملاحظة.');
  }

  function startVoiceInput() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
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

  async function scheduleFlashcardReview(knewIt: boolean) {
    if (!activeFlashcards || !currentFlashcardEntry) return;
    const current = currentFlashcardEntry.card;
    const originalIndex = currentFlashcardEntry.originalIndex;
    const intervalDays = knewIt
      ? Math.min(30, Math.max(1, (current.intervalDays || 0) === 0 ? 1 : (current.intervalDays || 1) * 2))
      : 0;
    const dueAt = knewIt ? Date.now() + intervalDays * 24 * 60 * 60 * 1000 : Date.now() + 10 * 60 * 1000;
    const updated: SavedFlashcardSet = {
      ...activeFlashcards,
      cards: activeFlashcards.cards.map((card, index) => index === originalIndex ? {
        ...card,
        dueAt,
        intervalDays,
        repetitions: (card.repetitions || 0) + 1
      } : card)
    };
    await saveFlashcardSet(updated);
    setActiveFlashcards(updated);
    setFlashcardSets((currentSets) => currentSets.map((item) => item.id === updated.id ? updated : item));
    setFlashcardRevealed(false);
    setNotice(knewIt ? 'تمت جدولة البطاقة لمراجعة لاحقة.' : 'سنرجع لهذه البطاقة بعد 10 دقائق.');
    if (reviewDueOnly) {
      setFlashcardIndex((index) => Math.min(index, Math.max(0, visibleFlashcards.length - 2)));
    } else if (flashcardIndex < updated.cards.length - 1) {
      setFlashcardIndex((index) => index + 1);
    }
  }

  async function restartQuiz() {
    if (!activeQuiz) return;
    const restarted: SavedQuiz = {
      ...activeQuiz,
      answers: Array(activeQuiz.questions.length).fill(-1),
      score: 0,
      completedAt: undefined
    };
    await saveQuiz(restarted);
    setActiveQuiz(restarted);
    setQuizzes((current) => current.map((quiz) => quiz.id === restarted.id ? restarted : quiz));
    setAnswers(restarted.answers);
    setGraded(false);
    setQuestionIndex(0);
    setTimeRemaining((restarted.durationMinutes || 0) * 60);
    setTimerActive(Boolean(restarted.durationMinutes));
    setExamMode(true);
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
    try {
      const savedScale = Number(window.localStorage.getItem('hema-uni-font-scale'));
      if (savedScale >= 80 && savedScale <= 130) setFontScale(savedScale);
    } catch { /* storage may be blocked */ }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--study-font-scale', String(fontScale / 100));
    try { window.localStorage.setItem('hema-uni-font-scale', String(fontScale)); } catch { /* storage may be blocked */ }
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
          <button className={view === 'quiz' ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveQuiz(null); setView('quiz'); }}><BookOpen size={18} /> الامتحانات <span className="nav-count">{quizzes.length}</span></button>
          <button className={view === 'flashcards' ? 'nav-item active' : 'nav-item'} onClick={() => setView('flashcards')}><Bookmark size={18} /> بطاقات الحفظ <span className="nav-count">{flashcardSets.length}</span></button>
          <button className={view === 'notes' ? 'nav-item active' : 'nav-item'} onClick={() => setView('notes')}><FileText size={18} /> دفتر الملاحظات <span className="nav-count">{notes.length}</span></button>
          <button className={view === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setView('settings')}><Settings size={18} /> الإعدادات</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="offline-note"><WifiOff size={17} /><span><strong>مكتبتك محلية</strong><small>ملفاتك محفوظة على جهازك</small></span></div>
          <p className="sidebar-disclaimer">مبادرة طلابية مستقلة، وليست منصة رسمية للجامعة.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Hema Uni</span><ChevronLeft size={15} /><strong>{({ home: 'الرئيسية', library: 'مكتبتي', quiz: 'الامتحانات', study: 'مدرس المحاضرة', flashcards: 'بطاقات الحفظ', notes: 'دفتر الملاحظات', settings: 'الإعدادات' } as Record<View, string>)[view]}</strong></div>
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
            <button className="action-card" onClick={() => selected ? (setActiveQuiz(null), setView('quiz')) : setView('library')}><span className="action-icon blue"><BookOpen size={22} /></span><strong>اختبر نفسك</strong><small>إنشاء امتحان مؤقت مع تصحيح ونتيجة</small><span className="card-link">إنشاء امتحان <ChevronLeft size={15} /></span></button>
            <button className="action-card" onClick={() => selected ? void ask('flashcards') : setView('library')}><span className="action-icon purple"><Bookmark size={22} /></span><strong>بطاقات الحفظ</strong><small>حوّل المفاهيم والتعاريف إلى بطاقات مراجعة</small><span className="card-link">إنشاء بطاقات <ChevronLeft size={15} /></span></button>
          </div>

          <div className="section-heading recent-heading"><div><h2>آخر محاضراتك</h2><p>تُحفظ على هذا الجهاز</p></div><button className="text-btn" onClick={() => setView('library')}>عرض المكتبة <ChevronLeft size={15} /></button></div>
          {materials.length ? <MaterialList materials={materials.slice(0, 4)} onOpen={(item) => { setSelectedId(item.id); setSelectedText(''); setSelectedPage(undefined); setQuestion(''); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
        </section>}

        {view === 'library' && <section className="page">
          <div className="page-intro"><span className="eyebrow">محتواك الدراسي</span><h1>مكتبتي</h1><p>ملفات محاضراتك محفوظة محليًا. لا تُرسل للمساعد إلا المقاطع اللازمة عند طلب الشرح.</p></div>
          <div className="library-toolbar"><span>{materials.length} محاضرة محفوظة</span><button className="primary-btn small" onClick={() => uploadRef.current?.click()}><FileUp size={17} /> أضف PDF</button></div>
          {materials.length ? <MaterialList materials={materials} onOpen={(item) => { setSelectedId(item.id); setSelectedText(''); setSelectedPage(undefined); setQuestion(''); setView('study'); setResult(null); }} onDelete={deleteMaterial} /> : <EmptyState onUpload={() => uploadRef.current?.click()} />}
          <div className="saved-quizzes"><div className="section-heading"><div><h2>اختبارات محفوظة</h2><p>تدريبات مؤقتة أو عادية من محاضراتك</p></div></div>
            {quizzes.length ? quizzes.map((quiz) => <button className="quiz-row" key={quiz.id} onClick={() => openQuiz(quiz)}><span className="quiz-row-icon"><BookOpen size={19} /></span><span className="quiz-row-info"><strong>{quiz.title}</strong><small>{quiz.questions.length} سؤال · {quiz.durationMinutes ? quiz.durationMinutes + ' دقيقة' : 'دون مؤقت'} · {new Date(quiz.createdAt).toLocaleDateString('ar')} · {quiz.completedAt ? 'النتيجة ' + quiz.score + '/' + quiz.questions.length : 'لم يُسلّم بعد'}</small></span><ChevronLeft size={18} /></button>) : <p className="muted-text">لم تنشئ اختبارات بعد.</p>}
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
                {selectedText && <div className="selected-text-box"><div><strong>النص المحدد — صفحة {selectedPage}</strong><button aria-label="مسح النص المحدد" onClick={() => { setSelectedText(''); setSelectedPage(undefined); }}><X size={14} /></button></div><p>{selectedText.slice(0, 360)}{selectedText.length > 360 ? '…' : ''}</p><div className="selected-text-actions"><button className="button-secondary" onClick={() => void saveCurrentNote() }><Bookmark size={14} /> احفظ في الدفتر</button><button className="primary-btn small" onClick={() => void ask('explain', selectedText, selectedPage)}>اشرح المقطع المحدد <Sparkles size={15} /></button></div></div>
                <p className="privacy-note"><AlertCircle size={14} /> عند استخدام AI، تُرسل مقتطفات من الصفحات المختارة إلى مزود الخدمة عبر الخادم.</p>
                {result && <div className="answer-box" ref={chatRef}>
                  <div className="answer-title"><Sparkles size={17} /><strong>{result.model ? 'إجابة المساعد' : 'النتيجة'}</strong></div>
                  <div className="answer-text">{result.text}</div>
                  {!!result.citations?.length && <div className="citations"><strong>المصادر من المحاضرة</strong>{result.citations.map((citation, index) => <button className="citation-chip" key={citation.page + '-' + index} onClick={() => jumpToPage(citation.page)}><FileText size={14} /> صفحة {citation.page}{citation.quote ? ' — ' + citation.quote.slice(0, 70) : ''}</button>)}</div>}
                </div>}
              </div>
              <div className="pages-panel">
                <div className="panel-head"><span className="pages-icon"><FileText size={19} /></span><div><strong>نص المحاضرة</strong><small>تقدر ترجع للمصدر بأي وقت</small></div></div>
                <div className="page-list">{selected.pages.map((page) => <article className="page-snippet" id={'page-' + page.page} key={page.page} onMouseUp={() => { const text = window.getSelection()?.toString().trim() || ''; if (text.length > 5) { setSelectedText(text.slice(0, 5000)); setSelectedPage(page.page); } }}><div className="page-snippet-head"><strong>صفحة {page.page}</strong><button onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuestion('اشرح محتوى الصفحة ' + page.page + ' مع مثال.'); setSelectedPage(page.page); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>اسأل عنها <ChevronLeft size={13} /></button></div><p>{page.text || 'لم يُستخرج نص من هذه الصفحة.'}</p><div className="page-snippet-actions"><button className="page-explain-button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const text = window.getSelection()?.toString().trim(); const focus = text && text.length > 5 ? text.slice(0, 5000) : page.text.slice(0, 5000); setSelectedText(focus); setSelectedPage(page.page); void ask('explain', focus, page.page); }}>اشرح المقطع <Sparkles size={13} /></button><button className="page-save-button" onMouseDown={(event) => event.preventDefault()} onClick={() => { const text = window.getSelection()?.toString().trim(); const focus = text && text.length > 5 ? text.slice(0, 5000) : page.text.slice(0, 5000); setSelectedText(focus); setSelectedPage(page.page); void saveCurrentNote(focus, page.page); }}>احفظ ملاحظة <Bookmark size={13} /></button></div></article>)}</div>
              </div>
            </div>
          </>}
        </section>}

        {view === 'quiz' && <section className="page">
          {!activeQuiz ? <div className="quiz-screen">
            <div className="page-intro"><span className="eyebrow"><Clock3 size={15} /> وضع الامتحان</span><h1>أنشئ امتحانك</h1><p>حدد المحاضرة والصعوبة والوقت. التصحيح والتفسير يظهران بعد التسليم.</p></div>
            {!selected ? <EmptyState onUpload={() => setView('library')} /> : <div className="exam-builder">
              <label>المحاضرة</label>
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select>
              <div className="exam-options">
                <div><label htmlFor="question-count">عدد الأسئلة</label><select id="question-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}><option value={5}>5 أسئلة</option><option value={10}>10 أسئلة</option><option value={15}>15 سؤالًا</option></select></div>
                <div><label htmlFor="exam-difficulty">الصعوبة</label><select id="exam-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as TutorDifficulty)}><option value="easy">سهل</option><option value="medium">متوسط</option><option value="hard">صعب</option></select></div>
                <div><label htmlFor="exam-duration">الوقت</label><select id="exam-duration" value={examDuration} onChange={(event) => setExamDuration(Number(event.target.value))}><option value={0}>دون مؤقت</option><option value={10}>10 دقائق</option><option value={15}>15 دقيقة</option><option value={20}>20 دقيقة</option><option value={30}>30 دقيقة</option></select></div>
              </div>
              <p className="muted-text">AI ينشئ أسئلة من نصوص المحاضرة المتاحة. راجع دائمًا التفسيرات مع المصدر.</p>
              <button className="primary-btn" disabled={busy || !selected.pages.some((page) => page.text.trim())} onClick={() => void ask('quiz')}>{busy ? <Loader2 className="spin" size={17} /> : <BookOpen size={17} />} إنشاء الامتحان</button>
            </div>
            <div className="saved-quizzes"><div className="section-heading"><div><h2>امتحانات سابقة</h2><p>نتائج محفوظة محليًا</p></div></div>
              {quizzes.length ? quizzes.map((quiz) => <button className="quiz-row" key={quiz.id} onClick={() => openQuiz(quiz)}><span className="quiz-row-icon"><BookOpen size={19} /></span><span className="quiz-row-info"><strong>{quiz.title}</strong><small>{quiz.questions.length} سؤال · {quiz.durationMinutes ? quiz.durationMinutes + ' دقيقة' : 'دون مؤقت'} · {quiz.completedAt ? 'النتيجة ' + quiz.score + '/' + quiz.questions.length : 'لم يُسلّم بعد'}</small></span><ChevronLeft size={18} /></button>) : <p className="muted-text">لم تحفظ امتحانات بعد.</p>}
            </div>
          </div> : <div className="quiz-screen">
            <button className="back-link" onClick={() => setView('library')}><ArrowRight size={16} /> العودة للمكتبة</button>
            <div className="page-intro"><span className="eyebrow"><BookOpen size={15} /> {activeQuiz.durationMinutes ? 'محاكاة امتحان' : 'تدريب قصير'}</span><h1>{activeQuiz.title}</h1><p>{activeQuiz.questions.length} سؤال · {activeQuiz.difficulty === 'hard' ? 'صعب' : activeQuiz.difficulty === 'easy' ? 'سهل' : 'متوسط'} · اختر الإجابات ثم صحّح.</p></div>
            <div className="exam-toolbar">
              <div className="exam-timer"><Clock3 size={17} /><span>{activeQuiz.durationMinutes ? (graded ? 'تم التسليم' : formatTime(timeRemaining)) : 'دون مؤقت'}</span></div>
              <button className={examMode ? 'mode-toggle active' : 'mode-toggle'} onClick={() => { setExamMode((value) => !value); setQuestionIndex(0); }}>{examMode ? 'سؤال واحد/شاشة' : 'عرض كل الأسئلة'}</button>
              <span className="exam-count">{Object.values(answers).filter((answer) => answer >= 0).length}/{activeQuiz.questions.length} مجاب</span>
            </div>
            {examMode && <div className="exam-progress"><div style={{ width: ((questionIndex + 1) / activeQuiz.questions.length * 100) + '%' }} /></div>}
            {graded && <div className="score-card"><span className="score-number">{activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0)}/{activeQuiz.questions.length}</span><div><strong>نتيجتك</strong><small>{activeQuiz.questions.reduce((sum, item, index) => sum + (answers[index] === item.correctIndex ? 1 : 0), 0) === activeQuiz.questions.length ? 'ممتاز! أجبت عن كل الأسئلة بشكل صحيح.' : 'راجع التفسيرات وحاول مرة ثانية.'}</small></div></div>}
            {(examMode ? activeQuiz.questions.map((item, index) => ({ item, index })).filter(({ index }) => index === questionIndex) : activeQuiz.questions.map((item, index) => ({ item, index }))).map(({ item, index }) => <QuestionCard key={activeQuiz.id + '-' + index} item={item} index={index} answer={answers[index] ?? -1} graded={graded} onAnswer={(value) => setAnswers((current) => { const next = [...current]; next[index] = value; return next; })} onPage={jumpToPage} />)}
            {examMode && !graded && <div className="exam-question-nav"><button className="button-secondary" disabled={questionIndex === 0} onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}><ChevronLeft size={16} /> السابق</button><span>السؤال {questionIndex + 1} من {activeQuiz.questions.length}</span>{questionIndex < activeQuiz.questions.length - 1 ? <button className="primary-btn small" onClick={() => setQuestionIndex((index) => Math.min(activeQuiz.questions.length - 1, index + 1))}>التالي <ArrowRight size={15} /></button> : <button className="primary-btn small" onClick={() => void gradeQuiz()}>تسليم الامتحان <CheckCircle2 size={15} /></button>}</div>}
            {graded && activeQuiz.questions.some((item, index) => answers[index] !== item.correctIndex) && <div className="mistake-review"><div className="section-heading"><div><h2>مراجعة الأخطاء</h2><p>أسئلة تحتاج إلى مراجعة</p></div></div>{activeQuiz.questions.map((item, index) => ({ item, index })).filter(({ item, index }) => answers[index] !== item.correctIndex).map(({ item, index }) => <QuestionCard key={'review-' + activeQuiz.id + '-' + index} item={item} index={index} answer={answers[index] ?? -1} graded onAnswer={() => undefined} onPage={jumpToPage} />)}</div>}
            <div className="quiz-bottom">{graded ? <button className="primary-btn" onClick={() => void restartQuiz()}>{'أعد الاختبار'} <RotateCcw size={16} /></button> : !examMode && <button className="primary-btn" onClick={() => void gradeQuiz()}>تصحيح الإجابات <ArrowRight size={16} /></button></div>
          </div>}
        </section>}

        {view === 'flashcards' && <section className="page">
          <div className="page-intro"><span className="eyebrow"><Bookmark size={15} /> مراجعة نشطة</span><h1>بطاقات الحفظ</h1><p>راجع التعريفات والمفاهيم بسرعة. كل بطاقة تعمل دون اتصال بعد حفظها.</p></div>
          {!activeFlashcards ? <>
            <div className="section-heading"><div><h2>إنشاء مجموعة جديدة</h2><p>حوّل محتوى محاضرة إلى بطاقات سؤال وجواب</p></div></div>
            <div className="flashcard-create">
              <label htmlFor="flashcard-material">المحاضرة</label>
              <select id="flashcard-material" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select>
              <button className="primary-btn" disabled={busy || !selected} onClick={() => void ask('flashcards')}><Sparkles size={17} /> إنشاء بطاقات بالذكاء الاصطناعي</button>
              {!selected && <p className="muted-text">ارفع PDF أولًا لبدء إنشاء البطاقات.</p>}
            </div>
            <div className="saved-quizzes"><div className="section-heading"><div><h2>مجموعاتي المحفوظة</h2><p>متاحة على هذا الجهاز</p></div></div>
              {flashcardSets.length ? flashcardSets.map((set) => <div className="saved-flashcard-row" key={set.id}><button className="quiz-row" onClick={() => openFlashcards(set)}><span className="quiz-row-icon"><Bookmark size={19} /></span><span className="quiz-row-info"><strong>{set.title}</strong><small>{set.cards.length} بطاقة · {new Date(set.createdAt).toLocaleDateString('ar')}</small></span><ChevronLeft size={18} /></button><button className="icon-btn delete-btn" aria-label="حذف المجموعة" onClick={() => void deleteFlashcardSet(set)}><Trash2 size={16} /></button></div>) : <p className="muted-text">لا توجد بطاقات محفوظة.</p>}
            </div>
          </> : <>
            <div className="flashcard-session-head"><button className="back-link" onClick={() => setActiveFlashcards(null)}><ArrowRight size={16} /> كل المجموعات</button><div className="flashcard-session-actions"><button className={reviewDueOnly ? 'mode-toggle active' : 'mode-toggle'} onClick={() => { setReviewDueOnly((value) => !value); setFlashcardIndex(0); setFlashcardRevealed(false); }}>{reviewDueOnly ? 'عرض كل البطاقات' : 'المستحق للمراجعة'}</button><span>{visibleFlashcards.length ? flashcardIndex + 1 : 0} / {visibleFlashcards.length}</span></div></div>
            {currentFlashcard ? <>
              <button className={'flashcard-face' + (flashcardRevealed ? ' revealed' : '')} onClick={() => setFlashcardRevealed((value) => !value)} aria-label="قلب بطاقة الحفظ">
                <span className="flashcard-label">{flashcardRevealed ? 'الإجابة' : 'السؤال / المصطلح'}</span>
                <strong>{flashcardRevealed ? currentFlashcard.back : currentFlashcard.front}</strong>
                {currentFlashcard.page && <small>مرجع المحاضرة: صفحة {currentFlashcard.page}</small>}
                <span className="flashcard-hint">{flashcardRevealed ? 'اضغط لإخفاء الإجابة' : 'اضغط لكشف الإجابة'}</span>
              </button>
              {currentFlashcard.dueAt && <p className="flashcard-due">موعد المراجعة: {new Date(currentFlashcard.dueAt).toLocaleString('ar')}</p>}
              {flashcardRevealed && <div className="flashcard-review-actions"><button className="button-secondary" onClick={() => void scheduleFlashcardReview(false)}>صعبة — راجع بعد 10 دقائق</button><button className="primary-btn small" onClick={() => void scheduleFlashcardReview(true)}>عرفتها — راجع لاحقًا <CheckCircle2 size={15} /></button></div>}
              <div className="flashcard-controls"><button className="button-secondary" disabled={flashcardIndex === 0} onClick={() => { setFlashcardIndex((index) => Math.max(0,index - 1)); setFlashcardRevealed(false); }}><ChevronLeft size={17} /> السابقة</button><button className="primary-btn" disabled={visibleFlashcards.length < 2} onClick={() => { setFlashcardIndex((index) => (index + 1) % visibleFlashcards.length); setFlashcardRevealed(false); }}>التالية <ArrowRight size={17} /></button></div>
              <div className="flashcard-dots">{visibleFlashcards.map(({ originalIndex }) => <button key={originalIndex} aria-label={'فتح البطاقة ' + (originalIndex + 1)} className={currentFlashcardEntry?.originalIndex === originalIndex ? 'active' : ''} onClick={() => { setFlashcardIndex(visibleFlashcards.findIndex((entry) => entry.originalIndex === originalIndex)); setFlashcardRevealed(false); }} />)}</div>
            </> : <div className="empty-state"><span className="empty-icon"><CheckCircle2 size={29} /></span><h3>{reviewDueOnly ? 'أنهيت البطاقات المستحقة' : 'لا توجد بطاقات'}</h3><p>{reviewDueOnly ? 'لا توجد بطاقات مستحقة الآن. البطاقات المجدولة ستظهر عند حلول وقت مراجعتها.' : 'هذه المجموعة لا تحتوي بطاقات.'}</p><button className="primary-btn" onClick={() => setReviewDueOnly(false)}>عرض كل البطاقات</button></div>}
          </>}
        </section>}

        {view === 'notes' && <section className="page">
          <div className="page-intro"><span className="eyebrow"><Bookmark size={15} /> مقتطفاتك المهمة</span><h1>دفتر الملاحظات</h1><p>احفظ التعريفات والمقاطع الصعبة من المحاضرات وارجع لها دون إعادة البحث.</p></div>
          {notes.length ? <div className="notes-list">{notes.map((note) => <article className="note-card" key={note.id}>
            <div className="note-card-head"><div><strong>{note.materialName}</strong><span>صفحة {note.page} · {new Date(note.createdAt).toLocaleDateString('ar')}</span></div><button className="icon-btn delete-btn" aria-label="حذف الملاحظة" onClick={() => void deleteNote(note)}><Trash2 size={15} /></button></div>
            <p>{note.text}</p>
            <div className="note-actions"><button className="button-secondary" onClick={() => { setSelectedId(note.materialId); setSelectedText(note.text); setSelectedPage(note.page); setQuestion('اشرح لي هذا المقتطف من المحاضرة مع مثال.'); setView('study'); window.setTimeout(() => document.getElementById('page-' + note.page)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); }}>افتح مع المحاضرة <ChevronLeft size={14} /></button><button className="page-explain-button" onClick={() => { setSelectedId(note.materialId); setSelectedText(note.text); setSelectedPage(note.page); setQuestion('اشرح لي هذا المقتطف من المحاضرة مع مثال.'); setView('study'); }}>جهّز للشرح <BrainCircuit size={13} /></button></div>
          </article>)}</div> : <div className="empty-state"><span className="empty-icon"><Bookmark size={29} /></span><h3>دفتر الملاحظات فارغ</h3><p>افتح محاضرة، حدّد فقرة، ثم احفظها هنا للمراجعة.</p><button className="primary-btn" onClick={() => materials.length ? (setSelectedId(materials[0].id), setView('study')) : setView('library')}>ابدأ من محاضراتك <ArrowRight size={16} /></button></div>}
        </section>}

        {view === 'settings' && <section className="page">
          <div className="page-intro"><span className="eyebrow"><Settings size={15} /> تخصيص</span><h1>الإعدادات</h1><p>تحكم براحة القراءة والخصوصية المحلية.</p></div>
          <div className="settings-card"><div className="settings-icon"><BookOpen size={21} /></div><div className="settings-copy"><h3>حجم النص</h3><p>كبّر أو صغّر نص المحاضرة والإجابات ليناسب شاشة هاتفك.</p><div className="font-size-control"><button className="button-secondary" onClick={() => setFontScale((value) => Math.max(80, value - 10))}>أصغر A−</button><strong>{fontScale}%</strong><button className="button-secondary" onClick={() => setFontScale((value) => Math.min(130, value + 10))}>أكبر A+</button></div></div></div>
          <div className="settings-card"><div className="settings-icon purple"><BrainCircuit size={21} /></div><div className="settings-copy"><h3>المساعد الذكي</h3><p>يتطلب نشر وظيفة الخادم وإضافة GEMINI_API_KEY كـ Secret في إعدادات Cloudflare. المفتاح لا يُحفظ داخل الواجهة أو APK.</p><a className="external-link" href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noreferrer">طريقة إنشاء مفتاح API <ChevronLeft size={15} /></a></div></div>
          <div className="settings-card"><div className="settings-icon teal"><WifiOff size={21} /></div><div className="settings-copy"><h3>الدراسة دون إنترنت</h3><p>المحاضرات والاختبارات والبطاقات المحفوظة تعمل محليًا. إجابات AI الجديدة تحتاج اتصالًا.</p><div className="offline-stats"><div><strong>{materials.length}</strong><span>محاضرات</span></div><div><strong>{quizzes.length}</strong><span>اختبارات</span></div><div><strong>{flashcardSets.length}</strong><span>مجموعات بطاقات</span></div><div><strong>{notes.length}</strong><span>ملاحظات</span></div></div></div></div>
          <div className="settings-card danger-card"><div className="settings-icon danger"><Trash2 size={21} /></div><div className="settings-copy"><h3>حذف البيانات</h3><p>حذف المحاضرات والاختبارات والبطاقات نهائيًا من هذا الجهاز.</p><button className="button-danger" onClick={async () => { if (!window.confirm('حذف كل المحاضرات والاختبارات والبطاقات من هذا الجهاز؟ لا يمكن التراجع.')) return; for (const material of materials) await removeMaterial(material.id); for (const set of flashcardSets) await removeFlashcardSet(set.id); setActiveFlashcards(null); await refreshLocalData(); setNotice('حُذفت البيانات المحلية.'); }}>حذف جميع البيانات</button></div></div>
        </section>}

        <nav className="mobile-nav" aria-label="التنقل الرئيسي للهاتف">
          <button className={view === 'home' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('home')}><Home size={19} /><span>الرئيسية</span></button>
          <button className={view === 'library' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('library')}><Library size={19} /><span>مكتبتي</span></button>
          <button className={view === 'study' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => selected ? setView('study') : setView('library')}><MessageCircle size={19} /><span>المساعد</span></button>
          <button className={view === 'quiz' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => { setActiveQuiz(null); setView('quiz'); }}><BookOpen size={19} /><span>الامتحانات</span></button>
          <button className={view === 'flashcards' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('flashcards')}><Bookmark size={19} /><span>بطاقات</span></button>
          <button className={view === 'notes' ? 'mobile-nav-item active' : 'mobile-nav-item'} onClick={() => setView('notes')}><FileText size={19} /><span>ملاحظات</span></button>
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

function PdfReader({ file }: { file: Blob }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [readerError, setReaderError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;
    setLoadingPdf(true);
    setReaderError('');
    setPdfDocument(null);
    setPageNumber(1);
    (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        loadingTask = getDocument({ data });
        const document = await loadingTask.promise;
        if (cancelled) {
          await document.destroy();
          return;
        }
        setPdfDocument(document);
        setPageCount(document.numPages);
      } catch {
        if (!cancelled) setReaderError('تعذر عرض صفحات PDF هنا. يمكنك الاستمرار باستخدام النص المستخرج أدناه.');
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || pageNumber < 1) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        setRendering(true);
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(260, (canvas.parentElement?.clientWidth || 640) - 28);
        const fitScale = Math.min(2.1, Math.max(0.4, availableWidth / baseViewport.width));
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
        });
        await renderTask.promise;
      } catch {
        if (!cancelled) setReaderError('تعذر رسم الصفحة الحالية. جرّب تغيير التكبير أو الانتقال لصفحة أخرى.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocument, pageNumber, zoom]);

  return <section className="pdf-reader">
    <div className="pdf-reader-toolbar">
      <div><FileText size={17} /><strong>قارئ المحاضرة</strong><span>{pageCount ? pageNumber + ' / ' + pageCount : 'PDF'}</span></div>
      <div className="pdf-reader-controls">
        <button className="icon-btn" title="تصغير" aria-label="تصغير" disabled={zoom <= 0.65} onClick={() => setZoom((value) => Math.max(0.65, Number((value - 0.15).toFixed(2))))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="تكبير" aria-label="تكبير" disabled={zoom >= 1.6} onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.15).toFixed(2))))}>+</button>
        <button className="icon-btn" title="الصفحة السابقة" aria-label="الصفحة السابقة" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}><ChevronLeft size={17} /></button>
        <button className="icon-btn" title="الصفحة التالية" aria-label="الصفحة التالية" disabled={!pageCount || pageNumber >= pageCount} onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}><ArrowRight size={17} /></button>
      </div>
    </div>
    {(loadingPdf || rendering) && <div className="pdf-reader-status"><Loader2 className="spin" size={16} /> {loadingPdf ? 'تحميل الملف...' : 'عرض الصفحة...'}</div>}
    {readerError && <div className="reader-warning"><AlertCircle size={15} />{readerError}</div>}
    <div className="pdf-canvas-stage"><canvas ref={canvasRef} aria-label={'صفحة PDF رقم ' + pageNumber} /></div>
    <div className="pdf-reader-footer"><span>النص قابل للتحديد في قسم «نص المحاضرة» أسفل المساعد.</span><span>{pageCount ? 'صفحة ' + pageNumber + ' من ' + pageCount : ''}</span></div>
  </section>;
}

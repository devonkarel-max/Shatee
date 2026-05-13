/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  LayoutGrid, 
  Zap, 
  Calendar, 
  CheckCircle2, 
  Plus, 
  Trash2,
  Moon,
  X,
  MessagesSquare,
  LogOut,
  User as UserIcon,
  History,
  Volume2,
  Search,
  Settings,
  Check,
  Compass
} from 'lucide-react';
import Markdown from 'react-markdown';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  User,
  OperationType,
  serverTimestamp,
  handleFirestoreError 
} from './lib/firebase';

// --- Types ---

const Type = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  INTEGER: 'INTEGER',
} as const;

interface SuggestedTask {
  text: string;
  description?: string;
  status: 'suggested' | 'added';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  userId: string;
  chatId: string;
  suggestedTask?: SuggestedTask;
}

interface Chat {
  id: string;
  title: string;
  userId: string;
  createdAt: number;
  lastMessageAt: number;
}

interface Task {
  id: string;
  text: string;
  description?: string;
  completed: boolean;
  dueDate: string; // ISO string
  createdAt: number;
  userId: string;
  sourceTaskId?: string;
  panelId?: string;
  type?: 'normal' | 'prove_it' | 'text_input';
  question?: string;
  answers?: { id: string; text: string; timestamp: number }[];
  proofRequired?: boolean;
  proofImageUrl?: string;
  aiFeedback?: string;
  audioUrl?: string;
  schedule?: {
    type: 'daily' | 'weekly' | 'interval';
    days?: number[];
    interval?: number;
    startDate?: number;
  };
}

interface TaskPanel {
  id: string;
  title: string;
  userId: string;
  order: number;
  createdAt: number;
  color?: 'gray' | 'blue' | 'red';
  tasks: string[];
}

interface UserSettings {
  userId: string;
  geminiApiKey: string;
  updatedAt: number;
}

interface Routine {
  id: string;
  userId: string;
  type: 'morning' | 'evening';
  taskIds: string[];
  updatedAt: number;
}

// --- Utils ---

// handleFirestoreError and OperationType moved to lib/firebase.ts

// --- Gemini Setup ---

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.07-3.71 1.07-2.85 0-5.27-1.92-6.13-4.51H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.87 14.13c-.22-.67-.35-1.39-.35-2.13s.13-1.46.35-2.13V7.03H2.18c-.77 1.58-1.21 3.35-1.21 5.22s.44 3.64 1.21 5.22l3.69-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.03l3.69 2.84c.86-2.59 3.28-4.51 6.13-4.51z" fill="#EA4335"/>
  </svg>
);

const FeatureItem = ({ icon, title, desc, theme }: { icon: React.ReactNode, title: string, desc: string, theme: string }) => (
  <div className="flex gap-4 items-start">
    <div className={`p-4 rounded-2xl shrink-0 transition-all ${theme === 'dark' ? 'bg-white/5 border border-white/5 text-blue-400' : 'bg-blue-50 border border-blue-100 text-blue-600'}`}>
      {icon}
    </div>
    <div className="space-y-1">
      <h3 className={`text-[11px] font-black uppercase tracking-[0.2em] ${theme === 'dark' ? 'text-white' : 'text-zinc-950'}`}>{title}</h3>
      <p className={`text-xs leading-relaxed font-medium ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-500'}`}>{desc}</p>
    </div>
  </div>
);

const SYSTEM_PROMPT = `You are Shate, a minimalist and efficient personal assistant. Your task is to help with time organization and management of morning and evening routines.

TASK AND ROUTINE INSTRUCTIONS:
1. Tasks now have different types:
   - "normal": Standard task.
   - "prove_it": Task requiring a photo as proof.
   - "text_input": Task requiring a text answer to a specific question.
2. If the user wants to create a task, call "suggest_task" or "create_task". 
3. For "text_input" tasks ALWAYS specify the "question" field.
4. Routines (morning/evening) are lists of tasks. You can view (get_routines) and update them (update_routine).
5. If the user wants to add a task to a routine, first ensure the task exists (create it if not).
6. Tasks must not be duplicated. If a task with the same name already exists, use it.
7. To update a routine, send the full new list of task titles in the desired order.

Communication rules:
- Speak naturally and concisely in English.
- Only mention time and date when requested.
- Be proactive but non-intrusive.`;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "suggest_task",
        description: "Suggests task creation to the user. Displays an interactive card in chat.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "Task name" },
            description: { type: Type.STRING, description: "Task description" },
            taskType: { type: Type.STRING, enum: ["normal", "prove_it", "text_input"], description: "Task type" },
            question: { type: Type.STRING, description: "Question for text_input task" }
          },
          required: ["text", "taskType"]
        }
      },
      {
        name: "create_task",
        description: "Directly creates a task in the user's list.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "Task name" },
            description: { type: Type.STRING, description: "Task description" },
            taskType: { type: Type.STRING, enum: ["normal", "prove_it", "text_input"], description: "Task type" },
            question: { type: Type.STRING, description: "Question for text_input task" }
          },
          required: ["text", "taskType"]
        }
      },
      {
        name: "get_routines",
        description: "Gets currently set routines (morning and evening) and the list of all user tasks.",
        parameters: { type: Type.OBJECT, properties: {} }
      },
      {
        name: "update_routine",
        description: "Updates morning or evening routine. Resets the task list in the given order.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["morning", "evening"], description: "Routine type" },
            taskTexts: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING }, 
              description: "List of task titles in the order they should appear." 
            }
          },
          required: ["type", "taskTexts"]
        }
      }
    ]
  }
];

// --- Components ---

const TaskCard = ({ 
  task, 
  onToggle, 
  onDelete, 
  onSchedule,
  onClick,
  showSchedule = false,
  isUploading = false,
  size = 'normal'
}: { 
  task: Task; 
  onToggle?: () => void;
  onDelete: () => void;
  onSchedule?: () => void;
  onClick?: () => void;
  showSchedule?: boolean;
  isUploading?: boolean;
  size?: 'normal' | 'small';
}) => {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div 
      onClick={() => size === 'small' ? onClick?.() : setShowDetails(!showDetails)}
      className={`bg-zinc-800/40 backdrop-blur-md border border-white/5 rounded-xl flex flex-col group shadow-md hover:shadow-blue-500/5 hover:border-blue-500/10 transition-all duration-300 cursor-pointer ${
        size === 'small' ? 'p-2.5 gap-1.5' : 'p-3.5 gap-3'
      }`}
    >
      <div className="flex items-center justify-between gap-2 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onToggle && (
            <button 
              disabled={isUploading}
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className={`rounded-full border-2 transition-all flex items-center justify-center shrink-0 ${
                size === 'small' ? 'w-4 h-4' : 'w-4.5 h-4.5'
              } ${
                task.completed ? 'bg-blue-600 border-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.3)]' : 'border-zinc-700 hover:border-blue-500'
              } ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isUploading ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-2.5 h-2.5 border border-white/20 border-t-white rounded-full" />
              ) : task.completed ? (
                <CheckCircle2 size={size === 'small' ? 8 : 10} strokeWidth={3} className="text-white" />
              ) : (task.proofRequired || task.type === 'prove_it') ? (
                <Zap size={size === 'small' ? 8 : 10} className="text-blue-400 fill-current" />
              ) : task.type === 'text_input' ? (
                <MessagesSquare size={size === 'small' ? 8 : 10} className="text-purple-400" />
              ) : null}
            </button>
          )}
          <div className="truncate flex-1">
            <p className={`font-bold truncate tracking-tight transition-all ${
              size === 'small' ? 'text-[11px]' : 'text-[13px]'
            } ${task.completed ? 'text-zinc-500 line-through' : 'text-zinc-100 group-hover:text-white'}`}>
              {task.text}
            </p>
          </div>
        </div>
        
        {size !== 'small' && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
            {showSchedule && onSchedule && (
              <button 
                onClick={(e) => { e.stopPropagation(); onSchedule(); }}
                className="p-2 bg-blue-600/10 text-blue-400 rounded-xl hover:bg-blue-600/20 transition-all border border-blue-500/10"
              >
                <Calendar size={12} strokeWidth={2.5} />
              </button>
            )}
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); }} 
              className="p-2 text-zinc-600 hover:text-red-500 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {task.description && (
              <div className="mt-2.5 pt-2.5 border-t border-white/5">
                <p className={`text-zinc-500 leading-relaxed font-medium ${size === 'small' ? 'text-[9px]' : 'text-[11px]'}`}>
                  {task.description}
                </p>
              </div>
            )}
            {task.completed && task.aiFeedback && (
              <div className="bg-blue-600/5 border-l-2 border-blue-600 p-2.5 rounded-lg flex gap-3 items-start mt-2">
                {task.proofImageUrl && (
                  <img src={task.proofImageUrl} alt="Proof" className="w-10 h-10 rounded-md object-cover border border-white/10 shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-1">Feedback from Shate</p>
                  <p className="text-[11px] text-zinc-300 leading-relaxed font-medium italic">"{task.aiFeedback}"</p>
                </div>
              </div>
            )}
            {task.answers && task.answers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Response history</p>
                <div className="space-y-1.5">
                  {task.answers.map(ans => (
                    <div key={ans.id} className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                      <p className="text-[11px] text-zinc-200 leading-relaxed">{ans.text}</p>
                      <p className="text-[8px] text-zinc-600 mt-1.5 flex justify-end">
                        {new Date(ans.timestamp).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Planning</p>
                <div className="flex gap-1.5">
                  {(['daily', 'weekly', 'interval'] as const).map(type => (
                    <button
                      key={type}
                      onClick={(e) => {
                        e.stopPropagation();
                        const updates: Partial<Task['schedule']> = {
                          type,
                          days: type === 'weekly' ? [1] : [],
                          interval: type === 'interval' ? 3 : 0,
                          startDate: Date.now()
                        };
                        updateDoc(doc(db, 'tasks', task.id), { schedule: updates });
                      }}
                      className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-md transition-all ${
                        (task.schedule?.type === type || (!task.schedule && type === 'daily'))
                          ? 'bg-blue-600 text-white' 
                          : 'bg-white/5 text-zinc-600 hover:text-zinc-400'
                      }`}
                    >
                      {type === 'daily' ? 'Daily' : type === 'weekly' ? 'Weekly' : 'Interval'}
                    </button>
                  ))}
                </div>
              </div>

              {task.schedule?.type === 'weekly' && (
                <div className="flex justify-between gap-1">
                  {[1,2,3,4,5,6,0].map(d => {
                    const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                    const isSelected = task.schedule?.days?.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={(e) => {
                          e.stopPropagation();
                          const currentDays = task.schedule?.days || [];
                          const newDays = isSelected 
                            ? currentDays.filter(day => day !== d)
                            : [...currentDays, d];
                          updateDoc(doc(db, 'tasks', task.id), { 
                            'schedule.days': newDays.length > 0 ? newDays : [d] 
                          });
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all ${
                          isSelected ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-zinc-400 border border-transparent'
                        }`}
                      >
                        {labels[d]}
                      </button>
                    );
                  })}
                </div>
              )}

              {task.schedule?.type === 'interval' && (
                <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/5">
                  <span className="text-[10px] font-bold text-zinc-400">Repeat every</span>
                  <div className="flex items-center gap-2">
                     <input 
                       type="number"
                       min="1"
                       max="99"
                       value={task.schedule.interval || 3}
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => {
                         const val = parseInt(e.target.value);
                         if (val > 0) {
                           updateDoc(doc(db, 'tasks', task.id), { 'schedule.interval': val });
                         }
                       }}
                       className="w-12 bg-zinc-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-bold text-center"
                     />
                     <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">days</span>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'explore' | 'today' | 'tasks'>('today');
  const [tasksView, setTasksView] = useState<'tasks' | 'routines'>('tasks');
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [isChatMode, setIsChatMode] = useState(false);
  const [showFullChat, setShowFullChat] = useState(false);
  const [expandedUserMsg, setExpandedUserMsg] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [tempApiKey, setTempApiKey] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [panels, setPanels] = useState<TaskPanel[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activeRoutineType, setActiveRoutineType] = useState<'morning' | 'evening'>('morning');
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceAmplitude, setVoiceAmplitude] = useState<number[]>(Array(5).fill(0));
  const [isTyping, setIsTyping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [showSettings, setShowSettings] = useState(false);
  const [showTaskDrawer, setShowTaskDrawer] = useState(false);
  const [showUnscheduledPicker, setShowUnscheduledPicker] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskType, setNewTaskType] = useState<'normal' | 'prove_it' | 'text_input'>('normal');
  const [newTaskQuestion, setNewTaskQuestion] = useState('');
  const [taskDrawerStep, setTaskDrawerStep] = useState<'name' | 'type' | 'extras'>('name');
  const [newTaskSchedule, setNewTaskSchedule] = useState<{ type: 'daily' | 'weekly' | 'interval', days?: number[], interval?: number, startDate?: number } | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [tempEditingTask, setTempEditingTask] = useState<Task | null>(null);
  const [proofTask, setProofTask] = useState<Task | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState<string | null>(null);
  const [currentSpeakingText, setCurrentSpeakingText] = useState('');
  const [spokenWordRange, setSpokenWordRange] = useState<{ start: number; end: number } | null>(null);

  const [showRoutinePicker, setShowRoutinePicker] = useState<'morning' | 'evening' | null>(null);
  const [activeRoutineRun, setActiveRoutineRun] = useState<{ type: string; taskIds: string[] } | null>(null);
  const [routineStepIndex, setRoutineStepIndex] = useState(0);
  const [routineAnswer, setRoutineAnswer] = useState('');
  const [textInputTask, setTextInputTask] = useState<Task | null>(null);
  const [textAnswer, setTextAnswer] = useState('');

  const lastErrorRef = useRef<string | null>(null);

  const playSound = (type: 'send' | 'start_reply' | 'thinking') => {
    if (!isSoundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      const now = audioCtx.currentTime;

      if (type === 'send') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, now);
        oscillator.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
        oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.04, now + 0.02);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
        oscillator.start(now);
        oscillator.stop(now + 0.1);
      } else if (type === 'start_reply') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, now);
        oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.05, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        oscillator.start(now);
        oscillator.stop(now + 0.15);
      } else if (type === 'thinking') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, now);
        gainNode.gain.setValueAtTime(0.02, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.4);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
      }
    } catch {
      // Audio feedback failed silently
    }
  };

  const playSuccessSound = () => playSound('send');

  const addMicLog = (msg: string) => {
    console.log(`Mic Log: ${msg}`);
  };
  
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const isRecognitionActiveRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const requestRef = useRef<number | null>(null);

  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...(options.headers || {}),
      'x-gemini-key': userSettings?.geminiApiKey || ''
    } as Record<string, string>;
    return fetch(url, { ...options, headers });
  };

  const syncRoutineToAgenda = async (type: 'morning' | 'evening', taskIds: string[]) => {
    if (!user || panels.length === 0) return;
    const panelName = type === 'morning' ? 'Morning Routine' : 'Evening Routine';
    const panel = panels.find(p => p.title === panelName);
    if (!panel) return;

    // Get today's start and end
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Find current tasks in this panel for today
    const currentTasks = tasks.filter(t => 
      t.panelId === panel.id && 
      t.dueDate && 
      new Date(t.dueDate) >= today && 
      new Date(t.dueDate) < tomorrow
    );

    // For each taskId in routine, if not in currentTasks, schedule it
    for (const tid of taskIds) {
      if (!currentTasks.some(t => t.sourceTaskId === tid)) {
        await scheduleTask(tid, today.toISOString(), panel.id);
      }
    }
  };

  // Synchronize routines with Agenda automatically
  useEffect(() => {
    if (!user || routines.length === 0 || panels.length === 0) return;
    
    const syncAll = async () => {
      for (const r of routines) {
        await syncRoutineToAgenda(r.type, r.taskIds);
      }
    };
    
    syncAll();
  }, [routines.length, panels.length, user]);

  // Handle audio playback when drawer opens
  useEffect(() => {
    if (editingTaskId) {
      const task = tasks.find(t => t.id === editingTaskId);
      if (task?.audioUrl) {
        playAudio(task.audioUrl);
      }
      if (task) {
        setTempEditingTask(task);
      }
    } else {
      setTempEditingTask(null);
    }
  }, [editingTaskId, tasks.find(t => t.id === editingTaskId)?.audioUrl]);

  // Authentication
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsLoggingIn(false);
      setIsAuthReady(true);
    });
  }, []);

  const login = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setIsLoggingIn(false);
      const authError = error as { code?: string };
      if (authError.code === 'auth/popup-closed-by-user' || authError.code === 'auth/cancelled-popup-request') {
        console.log("Login cancelled by user");
      } else {
        console.error("Login Error:", error);
      }
    }
  };

  const logout = () => auth.signOut();

  // Firestore Sync - Tasks
  useEffect(() => {
    if (!user) {
      setTasks([]);
      return;
    }
    const q = query(collection(db, 'tasks'), where('userId', '==', user.uid), orderBy('text', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const t = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task));
      setTasks(t);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'tasks'));
  }, [user]);

  // Firestore Sync - Messages
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }
    const q = query(collection(db, 'messages'), where('userId', '==', user.uid), where('chatId', '==', activeChatId), orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const m = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message));
      setMessages(m);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'messages'));
  }, [user, activeChatId]);

  // Firestore Sync - Chats
  useEffect(() => {
    if (!user) {
      setChats([]);
      return;
    }
    const q = query(collection(db, 'chats'), where('userId', '==', user.uid), orderBy('lastMessageAt', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const c = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Chat));
      setChats(c);
      
      // Auto-select latest chat if none selected
      if (c.length > 0 && !activeChatId) {
        setActiveChatId(c[c.length - 1].id);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'chats'));
  }, [user, activeChatId]);

  // Firestore Sync - Panels
  useEffect(() => {
    if (!user) {
      setPanels([]);
      return;
    }
    const q = query(collection(db, 'panels'), where('userId', '==', user.uid), orderBy('order', 'asc'));
    return onSnapshot(q, async (snapshot) => {
      const p = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TaskPanel));
      
      // Seed initial panels if empty as requested (3 panels)
      if (p.length === 0 && user) {
        const initialPanels = [
          { title: 'Today\'s Tasks', color: 'gray', order: 0 },
          { title: 'Morning Routine', color: 'blue', order: 1 },
          { title: 'Evening Routine', color: 'red', order: 2 }
        ];
        
        for (const ip of initialPanels) {
          try {
            await addDoc(collection(db, 'panels'), {
              ...ip,
              userId: user.uid,
              createdAt: Date.now()
            });
          } catch (e) {
            handleFirestoreError(e, OperationType.CREATE, 'panels');
          }
        }
      }
      
      setPanels(p);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'panels'));
  }, [user]);

  // Firestore Sync - Routines
  useEffect(() => {
    if (!user) {
      setRoutines([]);
      return;
    }
    const q = query(collection(db, 'routines'), where('userId', '==', user.uid));
    return onSnapshot(q, async (snapshot) => {
      const r = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Routine));
      
      // Auto-seed routines if missing
      if (r.length === 0 && user) {
        const initialRoutines = ['morning', 'evening'];
        for (const type of initialRoutines) {
          try {
            await addDoc(collection(db, 'routines'), {
              userId: user.uid,
              type,
              taskIds: [],
              updatedAt: Date.now()
            });
          } catch (e) {
            handleFirestoreError(e, OperationType.CREATE, 'routines');
          }
        }
      }
      
      setRoutines(r);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'routines'));
  }, [user]);

  // Firestore Sync - Settings
  useEffect(() => {
    if (!user) {
      setUserSettings(null);
      setTempApiKey('');
      return;
    }
    return onSnapshot(doc(db, 'userSettings', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as UserSettings;
        setUserSettings(data);
        setTempApiKey(data.geminiApiKey || '');
      } else {
        setUserSettings(null);
        setTempApiKey('');
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'userSettings'));
  }, [user]);

  const saveUserSettings = async () => {
    if (!user) return;
    setIsSavingSettings(true);
    try {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'userSettings', user.uid), {
        userId: user.uid,
        geminiApiKey: tempApiKey,
        updatedAt: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'userSettings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const testGeminiKey = async () => {
    if (!tempApiKey.trim()) {
      setTestResult({ success: false, message: 'Please enter a key.' });
      return;
    }
    
    setIsTestingKey(true);
    setTestResult(null);
    
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': tempApiKey
        },
        body: JSON.stringify({
          messages: [{ role: 'user', parts: [{ text: 'Respond with exactly one word: "OK"' }] }],
          systemInstruction: 'You are a testing assistant focusing on API connectivity test.',
        })
      });
      
      const data = await resp.json();
      if (resp.ok && data.text) {
        setTestResult({ success: true, message: 'Key is valid and functional!' });
      } else {
        const errorMsg = data.error || 'Error communicating with API.';
        setTestResult({ success: false, message: `Error: ${errorMsg}` });
      }
    } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setTestResult({ success: false, message: `Unexpected error: ${error.message || 'Connection failed'}` });
    } finally {
      setIsTestingKey(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current && isChatMode) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isChatMode, isTyping, showFullChat]);

  // Voice visualization effect with real audio data
  useEffect(() => {
    const startAudioAnalysis = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        analyserRef.current = audioContextRef.current.createAnalyser();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        analyserRef.current.fftSize = 64;
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateAmplitude = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Map frequency data to 5 bars
          const newAmplitudes = [0, 0, 0, 0, 0].map((_, i) => {
            const start = i * 2;
            const avg = (dataArray[start] + dataArray[start + 1]) / 2;
            return (avg / 255) * 100;
          });
          
          setVoiceAmplitude(newAmplitudes);
          requestRef.current = requestAnimationFrame(updateAmplitude);
        };
        
        requestRef.current = requestAnimationFrame(updateAmplitude);
      } catch (err) {
        console.error("Audio analysis failed:", err);
      }
    };

    const stopAudioAnalysis = () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };

    if (isRecording) {
      startAudioAnalysis();
    } else {
      stopAudioAnalysis();
      setVoiceAmplitude(Array(5).fill(0));
    }

    return stopAudioAnalysis;
  }, [isRecording]);

  // Looping search sound
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSearching && isSoundEnabled) {
      playSound('thinking');
      interval = setInterval(() => {
        playSound('thinking');
      }, 500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSearching, isSoundEnabled]);

  useEffect(() => {
    const SpeechRecognitionClass = (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      addMicLog("Preparing auxiliary detection");
      recognitionRef.current = new (SpeechRecognitionClass as { new(): unknown })();
      const recognition = recognitionRef.current as { 
        continuous: boolean, 
        interimResults: boolean, 
        lang: string,
        onresult: (event: unknown) => void,
        onstart: () => void,
        onend: () => void,
        onerror: (event: { error: string }) => void,
        stop: () => void,
        start: () => void
      };
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: unknown) => {
        let interimTranscript = '';
        const results = (event as { resultIndex: number, results: { isFinal: boolean, [key: number]: { transcript: string } }[] }).results;
        for (let i = (event as { resultIndex: number }).resultIndex; i < results.length; ++i) {
          if (results[i].isFinal) {
            const text = results[i][0].transcript;
            if (text) setInputText(text);
          } else {
            interimTranscript += results[i][0].transcript;
          }
        }
        if (interimTranscript) setInputText(interimTranscript);
      };

      recognition.onstart = () => {
        isRecognitionActiveRef.current = true;
        setIsRecording(true);
        addMicLog("LISTENING");
      };

      recognition.onend = () => {
        isRecognitionActiveRef.current = false;
      };

      recognition.onerror = (event: { error: string }) => {
        lastErrorRef.current = event.error;
        addMicLog(`STT Status: ${event.error}`);
      };
    }

    return () => {
      if (recognitionRef.current) {
        try { (recognitionRef.current as { stop: () => void }).stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  const speak = (text: string) => {
    if (!('speechSynthesis' in window) || !isSoundEnabled) return;
    window.speechSynthesis.cancel();
    
    // Clean text from Markdown and EMOJIS for speech
    const cleanText = text
      .replace(/[*_#`~>]/g, '')
      .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF]|[\u2011-\u26FF])/g, '')
      .trim();
    
    setCurrentSpeakingText(cleanText);
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US';
    utterance.rate = 1.7; // Fast rate as requested
    
    utterance.onstart = () => {
      addMicLog("Voice output started");
      setIsSpeaking(true);
      playSound('start_reply');
      // Ensure mic is strictly stopped while speaking to prevent echo
      if (isRecognitionActiveRef.current) {
        addMicLog("Forced microphone shutdown");
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // Ignore stop errors
          }
        }
      }
    };

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Find the full word boundary in the clean text
        const textToSearch = cleanText;
        let wordEnd = event.charIndex;
        while (wordEnd < textToSearch.length && /\S/.test(textToSearch[wordEnd])) {
          wordEnd++;
        }
        
        setSpokenWordRange({
          start: event.charIndex,
          end: wordEnd
        });
      }
    };

    utterance.onend = () => {
      addMicLog("Voice output finished");
      setIsSpeaking(false);
      setSpokenWordRange(null);
      setCurrentSpeakingText('');
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleAddSuggestedTask = async (messageId: string, task: SuggestedTask) => {
    await addTask(task.text, task.description);
    
    try {
      await updateDoc(doc(db, 'messages', messageId), {
        'suggestedTask.status': 'added'
      });
      playSound('start_reply');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `messages/${messageId}`);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || !user || isTyping) return;

    // Stop recording when sending to prevent feedback
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }

    let chatId = activeChatId;
    
    // Create new chat if none active
    if (!chatId) {
      const newChat: Omit<Chat, 'id'> = {
        title: textToSend.slice(0, 30) + (textToSend.length > 30 ? '...' : ''),
        userId: user.uid,
        createdAt: Date.now(),
        lastMessageAt: Date.now()
      };
      try {
        const chatDoc = await addDoc(collection(db, 'chats'), newChat);
        chatId = chatDoc.id;
        setActiveChatId(chatId);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'chats');
        return;
      }
    } else {
      // Update lastMessageAt
      try {
        await updateDoc(doc(db, 'chats', chatId), { lastMessageAt: Date.now() });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `chats/${chatId}`);
      }
    }

    const userMessage: Omit<Message, 'id'> = {
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
      userId: user.uid,
      chatId: chatId!
    };

    try {
      await addDoc(collection(db, 'messages'), userMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }

    setInputText('');
    setIsTyping(true);
    setIsSearching(true);
    setExpandedUserMsg(false);
    playSound('send');
    setTimeout(() => playSound('thinking'), 150);

    try {
      const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (userSettings?.geminiApiKey) {
        chatHeaders['x-gemini-key'] = userSettings.geminiApiKey;
      }

      const chatResp = await apiFetch('/api/chat', {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({ 
          messages: [
            ...messages.map(m => ({ 
              role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model', 
              parts: [{ text: m.content }] 
            })).slice(-10),
            { role: 'user', parts: [{ text: textToSend }] }
          ],
          systemInstruction: SYSTEM_PROMPT,
          tools: TOOLS
        })
      });

      if (!chatResp.ok) throw new Error("Server chat fail");
      const result = await chatResp.json();

      let assistantMsgContent = result.text || "";
      let suggestedTask: SuggestedTask | undefined;

      const functionCalls = result.functionCalls;
      
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          const { name } = call;
          const args = call.args as { 
            text?: string; 
            description?: string; 
            type?: 'morning' | 'evening'; 
            taskTexts?: string[];
            taskType?: 'normal' | 'prove_it' | 'text_input';
            question?: string;
          };
          if (name === 'suggest_task') {
            suggestedTask = {
              text: args.text as string,
              description: args.description || '',
              status: 'suggested'
            };
          } else if (name === 'create_task') {
            await addTask(
              args.text as string, 
              args.description || '', 
              '', 
              args.taskType || 'normal', 
              args.question
            );
            assistantMsgContent += `\n\n✅ Task "${args.text}" was added.`;
          } else if (name === 'get_routines') {
            const routinesData = routines.map(r => ({
              type: r.type,
              tasks: r.taskIds.map(id => tasks.find(t => t.id === id)?.text).filter(Boolean)
            }));
            const allTasks = tasks.filter(t => !t.sourceTaskId).map(t => t.text);
            assistantMsgContent += `\n\n[SYSTEM INFORMATION]: Current routines: ${JSON.stringify(routinesData)}. All library tasks: ${JSON.stringify(allTasks)}.`;
          } else if (name === 'update_routine') {
            const { type, taskTexts } = args;
            const newTaskIds = [];
            for (const tText of (taskTexts as string[])) {
              const id = await getOrCreateTaskId(tText);
              if (id) newTaskIds.push(id);
            }
            
            const existingRoutine = routines.find(r => r.type === type);
            if (existingRoutine) {
              await updateDoc(doc(db, 'routines', existingRoutine.id), {
                taskIds: newTaskIds,
                updatedAt: Date.now()
              });
            } else {
              await addDoc(collection(db, 'routines'), {
                userId: user.uid,
                type,
                taskIds: newTaskIds,
                updatedAt: Date.now()
              });
            }
            assistantMsgContent += `\n\n✅ Routine "${type === 'morning' ? 'morning' : 'evening'}" was updated.`;
          }
        }
      }

      const assistantMessage: Omit<Message, 'id'> = {
        role: 'assistant',
        content: assistantMsgContent || (suggestedTask ? "I suggest this task:" : "Sorry, something went wrong."),
        timestamp: Date.now(),
        userId: user.uid,
        chatId: chatId!,
        ...(suggestedTask ? { suggestedTask } : {})
      };

      try {
        await addDoc(collection(db, 'messages'), assistantMessage);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'messages');
      }
      setIsSearching(false);
      playSound('start_reply');
      speak(assistantMessage.content);
    } catch (error) {
      console.error("API Error during handleSend:", error);
      setIsSearching(false);
    } finally {
      setIsTyping(false);
      setIsSearching(false);
    }
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${id}`);
    }
  };

  const getOrCreateTaskId = async (text: string): Promise<string> => {
    if (!user) return '';
    const normalizedText = text.trim().toLowerCase();
    const existing = tasks.find(t => t.text.trim().toLowerCase() === normalizedText && !t.sourceTaskId);
    if (existing) return existing.id;
    
    const newTask: Omit<Task, 'id'> = { 
      text: text.trim(), 
      description: '',
      completed: false, 
      dueDate: '', 
      createdAt: Date.now(),
      userId: user.uid,
      sourceTaskId: '',
      type: 'normal',
      question: '',
      answers: []
    };
    try {
      const docRef = await addDoc(collection(db, 'tasks'), newTask);
      return docRef.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'tasks');
      return '';
    }
  };

  const isTaskScheduledForToday = (t: Task) => {
    if (!t.schedule || t.schedule.type === 'daily') return true;
    
    const now = new Date();
    const dayOfWeek = now.getDay();
    
    if (t.schedule.type === 'weekly' && t.schedule.days) {
      return t.schedule.days.includes(dayOfWeek);
    }
    
    if (t.schedule.type === 'interval' && t.schedule.interval && t.schedule.startDate) {
      const diffDays = Math.floor((now.getTime() - t.schedule.startDate) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays % t.schedule.interval === 0;
    }
    
    return true;
  };

  const addTask = async (
    text: string, 
    description: string = '', 
    date: string = '', 
    taskType: 'normal' | 'prove_it' | 'text_input' = 'normal',
    question?: string
  ): Promise<string> => {
    if (!user) return '';
    
    // Check for duplicate in library
    const normalizedText = text.trim().toLowerCase();
    const existing = tasks.find(t => t.text.trim().toLowerCase() === normalizedText && !t.sourceTaskId);
    
    if (existing) {
      if (date) await scheduleTask(existing.id, date);
      return existing.id;
    }

    const newTask: Omit<Task, 'id'> = { 
      text: text.trim(), 
      description,
      completed: false, 
      dueDate: date, 
      createdAt: Date.now(),
      userId: user.uid,
      sourceTaskId: '',
      type: taskType,
      question: question || '',
      answers: []
    };
    try {
      const docRef = await addDoc(collection(db, 'tasks'), newTask);
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskType('normal');
      setNewTaskQuestion('');
      setShowTaskDrawer(false);

      // Trigger background audio generation
      const speakText = description ? `${text}. ${description}` : text;
      apiFetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: speakText })
      }).then(res => res.json()).then(data => {
        if (data.audioData) {
          updateDoc(docRef, { audioUrl: data.audioData });
        }
      }).catch(err => console.error("Background audio generation failed:", err));

      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
      return '';
    }
  };

  const scheduleTask = async (taskId: string, date: string, panelId?: string) => {
    if (!user) return;
    const sourceTask = tasks.find(t => t.id === taskId);
    if (!sourceTask) return;

    const newTask: Omit<Task, 'id'> = {
      text: sourceTask.text,
      description: sourceTask.description || '',
      completed: false,
      dueDate: date,
      createdAt: Date.now(),
      userId: user.uid,
      sourceTaskId: taskId,
      panelId: panelId || '',
      type: sourceTask.type || 'normal',
      question: sourceTask.question || '',
      answers: []
    };

    try {
      const docRef = await addDoc(collection(db, 'tasks'), newTask);
      if (panelId) {
        const panel = panels.find(p => p.id === panelId);
        if (panel) {
          await updateDoc(doc(db, 'panels', panelId), {
            tasks: [...(panel.tasks || []), docRef.id],
            updatedAt: serverTimestamp()
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tasks');
    }
  };

  const playAudio = (base64Audio: string) => {
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes.buffer], { type: 'audio/mp3' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  };

  const handleProveIt = (task: Task) => {
    setProofTask(task);
  };

  const submitProof = async (file: File) => {
    if (!proofTask) return;
    const taskId = proofTask.id;
    const taskText = proofTask.text;
    
    setIsUploadingProof(taskId);
    try {
      // 1. Get Cloudinary Signature
      const sigResp = await apiFetch('/api/cloudinary-signature');
      const sigData = await sigResp.json();

      // 2. Upload to Cloudinary
      const formData = new FormData();
      formData.append('file', file);
      formData.append('api_key', sigData.api_key);
      formData.append('timestamp', sigData.timestamp);
      formData.append('signature', sigData.signature);
      formData.append('folder', 'tasks');

      const uploadResp = await fetch(`https://api.cloudinary.com/v1_1/${sigData.cloud_name}/image/upload`, {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadResp.json();
      const imageUrl = uploadData.secure_url;

      // 3. Analyze with Gemini
      const analyzeResp = await apiFetch('/api/analyze-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, taskText })
      });
      const analyzeData = await analyzeResp.json();
      const feedback = analyzeData.feedback;

      // 4. Generate Premium Voice Audio
      const audioResp = await apiFetch('/api/generate-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: feedback })
      });
      const audioData = await audioResp.json();

      // 5. Update Firestore
      await updateDoc(doc(db, 'tasks', taskId), {
        completed: true,
        proofImageUrl: imageUrl,
        aiFeedback: feedback,
        audioUrl: audioData.audioData
      });

      // 6. Play audio feedback immediately
      playAudio(audioData.audioData);
      setProofTask(null);
    } catch (err) {
      console.error("Proof submission failed:", err);
    } finally {
      setIsUploadingProof(null);
    }
  };

  const toggleTask = async (id: string, completed: boolean) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (!completed) {
      if (task.type === 'prove_it' || task.proofRequired) {
        handleProveIt(task);
        return;
      }

      if (task.type === 'text_input') {
        setTextInputTask(task);
        setTextAnswer('');
        return;
      }
    }

    try {
      await updateDoc(doc(db, 'tasks', id), { 
        completed: !completed,
        completedAt: !completed ? Date.now() : null,
        updatedAt: serverTimestamp()
      });
      if (!completed) playSuccessSound();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${id}`);
    }
  };

  const deleteTask = async (id: string) => {
    if (!user) return;
    try {
      // Parallel cleanup
      const panelCleanup = panels
        .filter(p => (p.tasks || []).includes(id))
        .map(p => updateDoc(doc(db, 'panels', p.id), { tasks: (p.tasks || []).filter(tid => tid !== id), updatedAt: serverTimestamp() }));
      
      const routineCleanup = routines
        .filter(r => (r.taskIds || []).includes(id))
        .map(r => updateDoc(doc(db, 'routines', r.id), { taskIds: (r.taskIds || []).filter(tid => tid !== id), updatedAt: Date.now() }));

      await Promise.all([...panelCleanup, ...routineCleanup]);
      await deleteDoc(doc(db, 'tasks', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${id}`);
    }
  };

  return (
    <div className={`min-h-screen selection:bg-blue-500/30 transition-colors duration-500 overflow-hidden ${theme === 'dark' ? 'bg-[#050505] text-white' : 'bg-zinc-100 text-zinc-900'}`}>
      
      {/* Three-Column Desktop Layout */}
      <div className="flex flex-col lg:flex-row min-h-screen items-stretch relative">
        
        {/* LEFT: App Description (Desktop only) */}
        <div className="hidden lg:flex lg:w-1/4 xl:w-1/3 flex-col justify-center p-16 space-y-12 overflow-y-auto">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-500/20">
                <Zap size={32} className="text-white fill-current translate-x-0.5" />
              </div>
              <h1 className="text-3xl font-black tracking-tighter text-white">Shate</h1>
            </div>
            <p className="text-2xl font-bold leading-tight max-w-sm">
              The future of your <span className="text-blue-500">productivity</span> starts with a morning routine.
            </p>
          </div>
          
          <div className="space-y-8 max-w-xs">
            <FeatureItem 
              theme={theme}
              icon={<Calendar size={20}/>} 
              title="Smart planning" 
              desc="Shate understands your day and helps you efficiently balance tasks between morning and evening blocks." 
            />
            <FeatureItem 
              theme={theme}
              icon={<Zap size={20}/>} 
              title="AI Verification" 
              desc="The 'Prove It' feature requires a photo as proof of completion. Shate checks it using AI." 
            />
            <FeatureItem 
              theme={theme}
              icon={<LayoutGrid size={20}/>} 
              title="Routines" 
              desc="Minimalist management of morning and evening routines to keep you in sync all day." 
            />
          </div>
        </div>

        {/* MIDDLE: Mobile Mockup */}
        <div className="flex-1 flex items-center justify-center p-0 lg:p-12 relative z-10">
          <div className="relative w-full lg:max-w-[420px] h-screen lg:h-[860px] lg:max-h-[96vh] lg:rounded-[3.5rem] bg-zinc-950 lg:border-[10px] lg:border-zinc-900 lg:shadow-[0_50px_100px_-20px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col">
            
            {/* Status Bar Mock (Desktop only) */}
            <div className="hidden lg:flex h-10 items-center justify-between px-10 absolute top-0 left-0 right-0 z-[100] bg-transparent">
              <span className="text-[10px] font-black text-zinc-600 tracking-tighter">9:41</span>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                <div className="w-4 h-2 bg-zinc-800 rounded-sm" />
              </div>
            </div>

            {/* The Actual Application Viewport */}
            <div className={`flex-1 flex flex-col relative overflow-hidden transition-colors duration-500 ${theme === 'dark' ? 'bg-zinc-950 text-white' : 'bg-zinc-50 text-zinc-900'}`}>
      {/* Header */}
      <header className="px-6 pt-10 pb-4 flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">Shate</h1>
          {user && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>}
        </div>
        
        {user && (
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => setShowHistory(true)}
              className="p-2.5 hover:bg-white/5 rounded-xl text-zinc-500 hover:text-white transition-all flex items-center gap-2"
              title="Chat history"
            >
              <History size={18} />
            </button>
            
            <div className="relative">
              <button 
                onClick={() => setShowSettings(true)} 
                className={`p-2.5 rounded-xl transition-all hover:bg-white/5 text-zinc-500 hover:text-white`}
              >
                <Settings size={18} />
              </button>

              <AnimatePresence>
                {showSettings && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`fixed inset-0 z-[500] flex flex-col items-center justify-center p-8 ${theme === 'dark' ? 'bg-zinc-950' : 'bg-zinc-50'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={`w-full max-w-xs space-y-6 p-8 rounded-3xl ${theme === 'dark' ? 'bg-zinc-900 border border-white/5' : 'bg-white border border-zinc-200'} shadow-2xl`}>
                      <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-blue-600/10 flex items-center justify-center">
                            <Settings size={18} className="text-blue-400" />
                          </div>
                          <h2 className={`text-lg font-bold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>Settings</h2>
                        </div>
                        <button 
                          onClick={() => setShowSettings(false)}
                          className={`p-2.5 rounded-xl transition-all shadow-inner ${theme === 'dark' ? 'bg-white/5 text-zinc-500 hover:text-white' : 'bg-zinc-100 text-zinc-400 hover:text-zinc-900'}`}
                        >
                          <X size={18} />
                        </button>
                      </div>

                      <div className={`border rounded-2xl p-4 flex items-center gap-3 ${theme === 'dark' ? 'bg-zinc-900/60 border-white/5' : 'bg-zinc-50 border-zinc-100'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden border ${theme === 'dark' ? 'bg-zinc-800 border-white/5' : 'bg-white border-zinc-200'}`}>
                          {user.photoURL ? (
                            <img src={user.photoURL} alt="User" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          ) : (
                            <UserIcon size={18} className="text-zinc-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-sm font-bold truncate leading-none ${theme === 'dark' ? 'text-white' : 'text-zinc-900'}`}>{user.displayName}</p>
                          <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest truncate mt-1">{user.email}</p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className={`p-4 border rounded-xl space-y-3 ${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-zinc-50 border-zinc-100'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Custom Gemini API Key</span>
                              <span className="text-[8px] text-zinc-500 mt-0.5">Optional - Shate has a built-in key</span>
                            </div>
                            <Zap size={14} className="text-amber-400" />
                          </div>
                          <div className="space-y-4">
                            <input 
                              type="password"
                              value={tempApiKey || ''}
                              onChange={(e) => {
                                setTempApiKey(e.target.value);
                                setTestResult(null);
                              }}
                              placeholder="Paste your key here..."
                              className={`w-full p-3 rounded-lg text-xs leading-none transition-all ${theme === 'dark' ? 'bg-black/50 border-white/5 text-white focus:border-blue-500' : 'bg-white border-zinc-200 text-zinc-900 focus:border-blue-400'} border outline-none`}
                            />
                            
                            <div className="flex gap-2">
                              <button 
                                onClick={(e) => { e.stopPropagation(); saveUserSettings(); }}
                                disabled={isSavingSettings || tempApiKey === (userSettings?.geminiApiKey || '')}
                                className={`flex-1 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                                  tempApiKey === (userSettings?.geminiApiKey || '') 
                                    ? 'bg-zinc-800 text-zinc-600 border border-zinc-700/50 cursor-default'
                                    : 'bg-blue-600 text-white hover:bg-blue-500 active:scale-95'
                                }`}
                              >
                                {isSavingSettings ? 'Saving...' : 'Save'}
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); testGeminiKey(); }}
                                disabled={isTestingKey || !tempApiKey.trim()}
                                className={`px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                                  isTestingKey ? 'bg-zinc-800 text-zinc-600' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white active:scale-95'
                                }`}
                              >
                                {isTestingKey ? 'Testing...' : 'Test'}
                              </button>
                            </div>

                            {testResult && (
                              <motion.div 
                                initial={{ opacity: 0, y: -5 }} 
                                animate={{ opacity: 1, y: 0 }}
                                className={`p-3 rounded-lg text-[9px] leading-relaxed font-semibold flex items-start gap-2.5 ${
                                  testResult.success ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                                }`}
                              >
                                {testResult.success ? <Check size={12} className="shrink-0 mt-0.5" /> : <Zap size={12} className="shrink-0 mt-0.5" />}
                                <span>{testResult.message}</span>
                              </motion.div>
                            )}

                            <p className="text-[8px] text-zinc-600 leading-tight">Paste the key as plain text. If you upload it as a file, it won't work.</p>
                          </div>

                        </div>

                        <div className={`flex items-center justify-between p-3.5 border rounded-xl ${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-zinc-50 border-zinc-100'}`}>
                          <span className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Audio output</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setIsSoundEnabled(!isSoundEnabled); }}
                            className={`w-8 h-4 rounded-full relative transition-all ${isSoundEnabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-800'}`}
                          >
                            <motion.div animate={{ x: isSoundEnabled ? 18 : 4 }} className="absolute top-1 w-2 h-2 bg-white rounded-full shadow-md" />
                          </button>
                        </div>

                        <div className={`flex items-center justify-between p-3.5 border rounded-xl ${theme === 'dark' ? 'bg-zinc-900 border-white/5' : 'bg-zinc-50 border-zinc-100'}`}>
                          <span className={`text-[11px] font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>Light mode</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setTheme(theme === 'dark' ? 'light' : 'dark'); }}
                            className={`w-8 h-4 rounded-full relative transition-all ${theme === 'light' ? 'bg-blue-400' : 'bg-zinc-300 dark:bg-zinc-800'}`}
                          >
                            <motion.div animate={{ x: theme === 'light' ? 18 : 4 }} className="absolute top-1 w-2 h-2 bg-white rounded-full shadow-md" />
                          </button>
                        </div>

                        <button 
                          onClick={(e) => { e.stopPropagation(); logout(); setShowSettings(false); }}
                          className="w-full p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center gap-2 text-red-500 font-bold text-[11px] uppercase tracking-widest hover:bg-red-500/20 transition-all active:scale-95"
                        >
                          <LogOut size={14} />
                          Log Out
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </header>

      {/* History Drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 z-[100] bg-zinc-950/60 backdrop-blur-sm"
            />
            {/* Panel */}
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-[70%] max-w-[280px] z-[101] bg-zinc-900 border-l border-white/5 flex flex-col shadow-2xl"
            >
              <div className="p-4 flex justify-between items-center border-b border-white/5 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-20">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-md bg-blue-500/20 flex items-center justify-center">
                    <History size={12} className="text-blue-400" />
                  </div>
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">History</h2>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-1.5 hover:bg-white/5 rounded-lg transition-all text-zinc-500"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-3 flex flex-col h-full overflow-hidden bg-zinc-950/20">
                <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1 pb-6">
                  {chats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 opacity-20 group">
                      <MessagesSquare size={24} className="mb-2 group-hover:scale-110 transition-transform" />
                      <p className="text-[10px] uppercase font-black tracking-widest">No chats</p>
                    </div>
                  ) : (
                    chats.map(chat => (
                      <div key={chat.id} className="relative group">
                        <button
                          onClick={() => {
                            setActiveChatId(chat.id);
                            setShowHistory(false);
                            setIsChatMode(true);
                            setShowFullChat(true);
                          }}
                          className={`w-full p-3 rounded-xl border transition-all text-left relative overflow-hidden ${
                            activeChatId === chat.id 
                              ? 'bg-zinc-800 border-white/10 shadow-xl' 
                              : 'bg-zinc-900/30 border-white/5 hover:bg-zinc-800/80 hover:border-white/10'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <p className={`text-[11px] font-bold truncate pr-6 ${activeChatId === chat.id ? 'text-white' : 'text-zinc-400'}`}>
                              {chat.title || "Untitled chat"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className={`w-1 h-1 rounded-full ${activeChatId === chat.id ? 'bg-blue-400' : 'bg-zinc-700'}`} />
                            <p className="text-[8px] text-zinc-600 uppercase font-black tracking-wider">
                              {new Date(chat.lastMessageAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-2 px-1">
                  <button 
                    onClick={() => {
                      setActiveChatId(null);
                      setMessages([]);
                      setShowHistory(false);
                      setIsChatMode(true);
                      setShowFullChat(true);
                    }}
                    className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-500 rounded-xl flex items-center justify-center gap-2 text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={14} strokeWidth={3} />
                    <span>New chat</span>
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt="User" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      ) : (
                        <UserIcon size={12} className="text-zinc-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold truncate text-zinc-400">{user?.displayName?.split(' ')[0]}</p>
                    </div>
                  </div>
                  <button onClick={logout} className="p-1.5 text-zinc-600 hover:text-red-500 transition-colors">
                    <LogOut size={12} />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>


      {!isAuthReady ? (
        <div className="flex-1 flex flex-col items-center justify-center bg-black p-8 space-y-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative"
          >
            <div className="w-20 h-20 bg-blue-600/10 rounded-[2.5rem] flex items-center justify-center">
              <Zap size={32} className="text-blue-500 fill-blue-500/20" />
            </div>
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="absolute inset-0 bg-blue-600/30 rounded-full blur-2xl -z-10"
            />
          </motion.div>
          
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-black text-white tracking-widest uppercase">Shate</h1>
            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.3em] animate-pulse">Syncing Session</p>
          </div>
        </div>
      ) : !user ? (
        <div className="flex-1 flex flex-col items-center justify-start py-12 px-8 text-center relative overflow-y-auto bg-black custom-scrollbar">
          {/* Animated Background Elements */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/10 blur-[120px] rounded-full animate-pulse [animation-delay:2s]" />
          
          <div className="relative z-10 w-full max-w-sm space-y-12">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="space-y-6"
            >
              <div className="space-y-2 pt-8">
                <h2 className="text-5xl font-black tracking-tighter text-white inline-block relative">
                  Shate
                  <span className="absolute -top-1 -right-4 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                </h2>
                <p className="text-zinc-500 text-sm leading-relaxed font-medium tracking-wide">
                  Intelligence for your daily flow.
                </p>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="grid grid-cols-1 gap-3 pt-4"
            >
              {[
                { icon: Zap, text: "AI powered routines", color: "text-blue-400" },
                { icon: MessagesSquare, text: "Natural chat interaction", color: "text-purple-400" },
                { icon: History, text: "Smart progress tracking", color: "text-emerald-400" }
              ].map((feature, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <feature.icon size={14} className={feature.color} />
                  <span className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-400">{feature.text}</span>
                </div>
              ))}
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="pt-8"
            >
              <button 
                onClick={login} 
                className="w-full h-16 bg-white text-zinc-950 font-black flex items-center justify-center gap-4 shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:bg-zinc-100 transition-all active:scale-[0.98] rounded-2xl text-xs group"
              >
                <div className="w-6 h-6 bg-zinc-100 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                  <GoogleIcon />
                </div>
                <span>Sign in with Google</span>
              </button>
              <p className="mt-6 text-[9px] font-bold text-zinc-700 uppercase tracking-widest">
                Protected by secure multi-factor auth
              </p>
            </motion.div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
          {activeTab === 'explore' ? (
            <motion.div 
              key="explore"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full px-6 pt-2 flex flex-col items-center justify-center text-center space-y-6 pb-32"
            >
              <div className="w-24 h-24 rounded-[2.5rem] bg-zinc-900 border-2 border-white/5 flex items-center justify-center shadow-2xl relative group">
                <div className="absolute inset-0 bg-blue-600/10 rounded-[2.5rem] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <Compass size={40} className="text-zinc-700 group-hover:text-blue-500 transition-colors" strokeWidth={1.5} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">Explore Shate</h2>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] max-w-[240px] mx-auto leading-loose">New horizons, routines and AI specialized agents coming soon.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                {[1,2,3,4].map(i => (
                  <div key={i} className="aspect-square bg-zinc-900/50 border border-white/5 rounded-3xl animate-pulse" />
                ))}
              </div>
            </motion.div>
          ) : activeTab === 'today' ? (
            <motion.div 
              key="today"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full px-6 pt-2 space-y-8 overflow-y-auto pb-32"
            >
              {/* Calendar section */}
              <div id="daily-agenda" className="bg-zinc-900/40 rounded-[2rem] p-4 border border-blue-500/10 shadow-[0_0_40px_rgba(59,130,246,0.06)] relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
                <div className="flex justify-between items-center mb-4 relative z-10">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-500/50">Daily agenda</span>
                    <span className="text-xs font-black tracking-tight text-white/90">May 2026</span>
                  </div>
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center relative z-10 pt-1">
                  {['Mo','Tu','We','Th','Fr','Sa','Su'].map((d) => (
                    <span key={d} className="text-[7px] font-black text-zinc-700 uppercase tracking-tighter mb-1">{d}</span>
                  ))}
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <span key={d} className="relative group/day py-0.5 cursor-pointer" onClick={() => setSelectedDay(d)}>
                      <span className={`text-[9px] font-bold w-7 h-7 flex items-center justify-center mx-auto rounded-full transition-all relative z-10
                        ${d === selectedDay ? 'text-white font-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}
                      `}>
                        {d}
                        {d === selectedDay && (
                          <motion.div 
                            layoutId="activeDay"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            className="absolute inset-0 bg-blue-600 rounded-full -z-10 shadow-[0_0_15px_rgba(37,99,235,0.5)]"
                          />
                        )}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory custom-scrollbar -mx-6 px-6 scroll-smooth">
                {/* Panel 1: Today's Tasks */}
                <motion.div 
                  layoutId="panel-today"
                  className="min-w-[280px] aspect-[5/8] snap-center flex flex-col group"
                >
                  <div className="flex justify-between items-center mb-5 px-3">
                     <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover:text-orange-500 transition-colors">TODAY</h3>
                     <button 
                        onClick={(e) => { e.stopPropagation(); setShowUnscheduledPicker(true); }}
                        className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600 hover:text-white hover:bg-orange-600 transition-all active:scale-90"
                     >
                       <Plus size={14} strokeWidth={3} />
                     </button>
                  </div>
                  <div className="flex-1 bg-zinc-900 border-2 border-white/5 p-5 rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-2xl relative group-hover:border-orange-500/20 transition-all duration-700">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                      {(() => {
                        const dailyTasks = tasks.filter(t => {
                          if (!t.dueDate || t.panelId) return false;
                          const d = new Date(t.dueDate);
                          const isRoutineTask = routines.some(r => (r.taskIds || []).includes(t.id));
                          return d.getDate() === selectedDay && d.getMonth() === 4 && !isRoutineTask; 
                        });
                        
                        if (dailyTasks.length === 0) {
                          return (
                            <div className="h-full flex flex-col items-center justify-center opacity-10 py-10 scale-75">
                              <LayoutGrid size={60} strokeWidth={1} className="mb-4 text-orange-500" />
                              <p className="text-[10px] font-black uppercase tracking-[0.3em]">DONE</p>
                            </div>
                          );
                        }
                        return dailyTasks.map(t => (
                          <TaskCard 
                            key={t.id} 
                            task={t} 
                            size="small"
                            onToggle={() => toggleTask(t.id, t.completed)}
                            onDelete={() => deleteTask(t.id)}
                            onClick={() => setEditingTaskId(t.id)}
                          />
                        ));
                      })()}
                    </div>
                  </div>
                </motion.div>

                {/* Panel 2: Morning Routine */}
                <motion.div 
                  layoutId="panel-morning"
                  className="min-w-[280px] aspect-[5/8] snap-center flex flex-col group/r"
                >
                  <div className="flex justify-between items-center mb-5 px-3">
                     <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/r:text-yellow-500 transition-colors">MORNING ROUTINE</h3>
                     <button 
                        onClick={(e) => { e.stopPropagation(); setShowRoutinePicker('morning'); }}
                        className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600 hover:text-white hover:bg-yellow-600 transition-all active:scale-90"
                     >
                       <Plus size={14} strokeWidth={3} />
                     </button>
                  </div>
                  <div className="flex-1 bg-zinc-900 border-2 border-white/5 p-5 rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-2xl relative group-hover/r:border-yellow-500/20 transition-all duration-700">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent opacity-0 group-hover/r:opacity-100 transition-opacity" />
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                      {(() => {
                        const routine = routines.find(r => r.type === 'morning');
                        const routineTasks = (routine?.taskIds || [])
                          .map(tid => tasks.find(t => t.id === tid))
                          .filter(t => t && isTaskScheduledForToday(t)) as Task[];
                        
                        if (routineTasks.length === 0) {
                          return (
                            <div className="h-full flex flex-col items-center justify-center opacity-10 py-10 scale-75">
                              <Zap size={60} strokeWidth={1} className="mb-4 text-yellow-500" />
                              <p className="text-[10px] font-black uppercase tracking-[0.3em]">EMPTY</p>
                            </div>
                          );
                        }
                        return routineTasks.map(t => (
                          <TaskCard 
                            key={t.id} 
                            task={t} 
                            size="small"
                            onToggle={() => toggleTask(t.id, t.completed)}
                            onDelete={() => deleteTask(t.id)}
                            onClick={() => setEditingTaskId(t.id)}
                          />
                        ));
                      })()}
                    </div>
                    {(() => {
                      const routine = routines.find(r => r.type === 'morning');
                      const routineTasks = (routine?.taskIds || []).filter(tid => {
                        const t = tasks.find(x => x.id === tid);
                        return t && !t.completed;
                      });
                      if (routineTasks.length > 0) {
                        return (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveRoutineRun({ type: 'morning', taskIds: routine!.taskIds || [] });
                              setRoutineStepIndex(0);
                            }}
                            className="mt-4 w-full py-4 bg-yellow-600/10 hover:bg-yellow-600 text-yellow-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 border border-yellow-500/20"
                          >
                            <Zap size={14} className="fill-current" />
                            START
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </motion.div>

                {/* Panel 3: Evening Routine */}
                <motion.div 
                  layoutId="panel-evening"
                  className="min-w-[280px] aspect-[5/8] snap-center flex flex-col group/v"
                >
                  <div className="flex justify-between items-center mb-5 px-3">
                     <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 group-hover/v:text-indigo-500 transition-colors">EVENING ROUTINE</h3>
                     <button 
                        onClick={(e) => { e.stopPropagation(); setShowRoutinePicker('evening'); }}
                        className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-zinc-600 hover:text-white hover:bg-indigo-600 transition-all active:scale-90"
                     >
                       <Plus size={14} strokeWidth={3} />
                     </button>
                  </div>
                  <div className="flex-1 bg-zinc-900 border-2 border-white/5 p-5 rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-2xl relative group-hover/v:border-indigo-500/20 transition-all duration-700">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent opacity-0 group-hover/v:opacity-100 transition-opacity" />
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                      {(() => {
                        const routine = routines.find(r => r.type === 'evening');
                        const routineTasks = (routine?.taskIds || [])
                          .map(tid => tasks.find(t => t.id === tid))
                          .filter(t => t && isTaskScheduledForToday(t)) as Task[];
                        
                        if (routineTasks.length === 0) {
                          return (
                            <div className="h-full flex flex-col items-center justify-center opacity-10 py-10 scale-75">
                              <Moon size={60} strokeWidth={1} className="mb-4 text-indigo-500" />
                              <p className="text-[10px] font-black uppercase tracking-[0.3em]">EMPTY</p>
                            </div>
                          );
                        }
                        return routineTasks.map(t => (
                          <TaskCard 
                            key={t.id} 
                            task={t} 
                            size="small"
                            onToggle={() => toggleTask(t.id, t.completed)}
                            onDelete={() => deleteTask(t.id)}
                            onClick={() => setEditingTaskId(t.id)}
                          />
                        ));
                      })()}
                    </div>
                    {(() => {
                      const routine = routines.find(r => r.type === 'evening');
                      const routineTasks = (routine?.taskIds || []).filter(tid => {
                        const t = tasks.find(x => x.id === tid);
                        return t && !t.completed;
                      });
                      if (routineTasks.length > 0) {
                        return (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveRoutineRun({ type: 'evening', taskIds: routine!.taskIds || [] });
                              setRoutineStepIndex(0);
                            }}
                            className="mt-4 w-full py-4 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-500 hover:text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 border border-indigo-500/20"
                          >
                            <Moon size={14} className="fill-current" />
                            START
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </motion.div>
              </div>

              <AnimatePresence>
                {textInputTask && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setTextInputTask(null)}
                      className="fixed inset-0 z-[200] bg-zinc-950/90 backdrop-blur-md"
                    />
                    <motion.div 
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "100%" }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                      className="fixed inset-x-0 bottom-0 z-[201] bg-zinc-900 border-t border-white/5 rounded-t-[2.5rem] shadow-[0_-10px_50px_rgba(0,0,0,0.5)] flex flex-col h-[75vh] max-w-md mx-auto overflow-hidden p-8"
                    >
                      <div className="w-10 h-1 bg-zinc-800/50 rounded-full mx-auto mb-6 shrink-0" />
                      
                      <div className="flex-1 flex flex-col pt-4">
                        <div className="mb-8 px-2">
                          <p className="text-[9px] font-black uppercase tracking-[0.4em] text-purple-500 mb-2">DIALOG</p>
                          <div className="space-y-2">
                            <h2 className="text-2xl font-bold text-white tracking-tight leading-tight">{textInputTask.text}</h2>
                            {textInputTask.description && <p className="text-zinc-500 text-sm leading-relaxed">{textInputTask.description}</p>}
                          </div>
                        </div>

                        <div className="flex-1 flex flex-col gap-6 px-2 overflow-y-auto min-h-0">
                          <div className="relative group">
                            <div className="absolute left-4 top-4 text-zinc-700 group-focus-within:text-purple-500 transition-colors">
                              <MessagesSquare size={14} />
                            </div>
                            <textarea 
                              value={textAnswer}
                              onChange={(e) => setTextAnswer(e.target.value)}
                              autoFocus
                              placeholder="Type your answer here..."
                              className="w-full bg-zinc-950/50 border border-white/5 rounded-2xl p-4 pl-10 text-[13px] text-white placeholder:text-zinc-800 focus:outline-none focus:border-purple-500/20 transition-all font-medium tracking-tight h-32 resize-none"
                            />
                          </div>
                        </div>

                        <div className="mt-8 flex flex-col gap-3 pb-4">
                          <button 
                            disabled={!textAnswer.trim()}
                            onClick={async () => {
                              const newAnswer = {
                                id: Math.random().toString(36).substring(2, 11),
                                text: textAnswer,
                                timestamp: Date.now()
                              };
                              const updatedAnswers = [...(textInputTask.answers || []), newAnswer];
                              try {
                                await updateDoc(doc(db, 'tasks', textInputTask.id), {
                                  completed: true,
                                  answers: updatedAnswers,
                                  completedAt: Date.now(),
                                  updatedAt: serverTimestamp()
                                });
                                playSuccessSound();
                                setTextInputTask(null);
                                setTextAnswer('');
                              } catch (e) {
                                handleFirestoreError(e, OperationType.UPDATE, `tasks/${textInputTask.id}`);
                              }
                            }}
                            className="w-full py-5 bg-purple-600 disabled:bg-zinc-800/50 disabled:text-zinc-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
                          >
                            <Check size={16} strokeWidth={3} />
                            CONFIRM
                          </button>
                          <button 
                            onClick={() => setTextInputTask(null)}
                            className="w-full py-3 text-zinc-600 text-[8px] font-black uppercase tracking-widest hover:text-zinc-400 transition-colors"
                          >
                            CANCEL
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}

                {activeRoutineRun && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setActiveRoutineRun(null)}
                      className="fixed inset-0 z-[200] bg-zinc-950/90 backdrop-blur-md"
                    />
                    <motion.div 
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "100%" }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                      className="fixed inset-x-0 bottom-0 z-[201] bg-zinc-900 border-t border-white/5 rounded-t-[2.5rem] shadow-[0_-10px_50px_rgba(0,0,0,0.5)] flex flex-col h-[75vh] max-w-md mx-auto overflow-hidden p-8"
                    >
                      <div className="w-10 h-1 bg-zinc-800/50 rounded-full mx-auto mb-6 shrink-0" />
                      
                      {(() => {
                        const uncompletedTaskIds = activeRoutineRun.taskIds.filter(tid => {
                          const t = tasks.find(x => x.id === tid);
                          return t && !t.completed && isTaskScheduledForToday(t);
                        });
                        
                        if (uncompletedTaskIds.length === 0 || routineStepIndex >= uncompletedTaskIds.length) {
                          return (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                              <motion.div 
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center shadow-[0_0_40px_rgba(37,99,235,0.3)] mb-8"
                              >
                                <Check size={32} className="text-white" strokeWidth={3} />
                              </motion.div>
                              <h3 className="text-xl font-bold text-white mb-1">Great Job!</h3>
                              <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mb-12">Routine completed</p>
                              <button 
                                onClick={() => setActiveRoutineRun(null)}
                                className="w-full py-5 bg-white text-zinc-950 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] active:scale-95 transition-all"
                              >
                                BACK TO MENU
                              </button>
                            </div>
                          );
                        }

                        const taskId = uncompletedTaskIds[routineStepIndex];
                        const task = tasks.find(t => t.id === taskId);
                        if (!task) return null;

                        return (
                          <div className="flex-1 flex flex-col pt-4">
                            <div className="mb-10 px-2">
                              <p className="text-[9px] font-black uppercase tracking-[0.4em] text-zinc-600 mb-2">STEP {routineStepIndex + 1} OF {uncompletedTaskIds.length}</p>
                              <div className="h-1 bg-zinc-800/50 rounded-full overflow-hidden">
                                <motion.div 
                                  className="h-full bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${((routineStepIndex + 1) / uncompletedTaskIds.length) * 100}%` }}
                                />
                              </div>
                            </div>

                            <div className="flex-1 flex flex-col justify-center gap-1 px-2 overflow-y-auto min-h-0">
                              <div className="space-y-0.5">
                                <h2 className="text-base font-bold text-white tracking-tight leading-tight">{task.text}</h2>
                                {task.description && <p className="text-zinc-500 text-[9px] leading-relaxed">{task.description}</p>}
                              </div>
                              
                              {task.type === 'text_input' && (
                                <div className="space-y-4">
                                  <div className="relative group">
                                    <div className="absolute left-4 top-4 text-zinc-700 group-focus-within:text-blue-500 transition-colors">
                                      <MessagesSquare size={14} />
                                    </div>
                                    <textarea 
                                      value={routineAnswer}
                                      onChange={(e) => setRoutineAnswer(e.target.value)}
                                      autoFocus
                                      placeholder="Type your answer here..."
                                      className="w-full bg-zinc-950/50 border border-white/5 rounded-2xl p-4 pl-10 text-[13px] text-white placeholder:text-zinc-800 focus:outline-none focus:border-blue-500/20 transition-all font-medium tracking-tight h-24 resize-none"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="mt-10 flex flex-col gap-3 pb-4">
                              <button 
                                disabled={task.type === 'text_input' && !routineAnswer.trim()}
                                onClick={async () => {
                                  if (task.type === 'text_input') {
                                    const newAnswer = {
                                      id: Math.random().toString(36).substring(2, 11),
                                      text: routineAnswer,
                                      timestamp: Date.now()
                                    };
                                    const updatedAnswers = [...(task.answers || []), newAnswer];
                                    await updateDoc(doc(db, 'tasks', task.id), {
                                      completed: true,
                                      answers: updatedAnswers,
                                      completedAt: Date.now(),
                                      updatedAt: serverTimestamp()
                                    });
                                    setRoutineAnswer('');
                                    playSuccessSound();
                                  } else {
                                    await toggleTask(task.id, false);
                                  }
                                  setRoutineStepIndex(prev => prev + 1);
                                }}
                                className="w-full py-5 bg-blue-600 disabled:bg-zinc-800/50 disabled:text-zinc-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
                              >
                                <Check size={16} strokeWidth={3} />
                                DONE
                              </button>
                              <button 
                                onClick={() => setActiveRoutineRun(null)}
                                className="w-full py-3 text-zinc-600 text-[8px] font-black uppercase tracking-widest hover:text-zinc-400 transition-colors"
                              >
                                ABORT ROUTINE
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {showUnscheduledPicker && (
                  <>
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setShowUnscheduledPicker(false)}
                      className="fixed inset-0 z-[150] bg-zinc-950/80 backdrop-blur-sm"
                    />
                    <motion.div 
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "100%" }}
                      transition={{ type: "spring", damping: 25, stiffness: 200 }}
                      className="fixed inset-x-0 bottom-0 z-[151] bg-zinc-900 border-t border-white/10 rounded-t-3xl shadow-[0_-20px_40px_rgba(0,0,0,0.5)] flex flex-col max-h-[80vh] max-w-md mx-auto"
                    >
                      <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto my-6 shrink-0" />
                      <div className="px-8 pb-6 flex justify-between items-center">
                        <div>
                          <h2 className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-500">Pick to Agenda</h2>
                          <p className="text-sm font-bold text-white tracking-tight">Concepts Library</p>
                        </div>
                        <button 
                          onClick={() => setShowUnscheduledPicker(false)}
                          className="p-2.5 bg-white/5 rounded-2xl text-zinc-400 hover:text-white transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto px-6 pb-12 space-y-3 custom-scrollbar">
                        {tasks.filter(t => !t.sourceTaskId).length === 0 ? (
                          <div className="py-20 text-center opacity-40">
                            <LayoutGrid size={40} className="mx-auto mb-4 text-zinc-700" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">No concepts available</p>
                          </div>
                        ) : (
                          tasks.filter(t => !t.sourceTaskId)
                            .sort((a,b) => a.text.localeCompare(b.text))
                            .map(t => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  const date = new Date(2026, 4, selectedDay);
                                  scheduleTask(t.id, date.toISOString());
                                  setShowUnscheduledPicker(false);
                                }}
                                className="w-full text-left p-4 rounded-2xl bg-zinc-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/20 transition-all group flex items-center justify-between"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-bold text-zinc-100 group-hover:text-white transition-colors">{t.text}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`text-[7px] font-black uppercase tracking-widest px-1 py-0.5 rounded ${
                                      t.type === 'prove_it' ? 'bg-orange-500/20 text-orange-400' :
                                      t.type === 'text_input' ? 'bg-purple-500/20 text-purple-400' :
                                      'bg-zinc-800 text-zinc-500'
                                    }`}>
                                      {t.type || 'normal'}
                                    </span>
                                    {t.description && <p className="text-[10px] text-zinc-500 truncate">{t.description}</p>}
                                  </div>
                                </div>
                                <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-blue-600 transition-all text-zinc-600 group-hover:text-white">
                                  <Plus size={16} />
                                </div>
                              </button>
                            ))
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

            </motion.div>
          ) : (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full px-6 pt-2 space-y-6 overflow-y-auto pb-32"
            >
              <div className="flex bg-zinc-950/40 p-1 rounded-2xl border border-white/5">
                <button 
                  onClick={() => setTasksView('tasks')}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${tasksView === 'tasks' ? 'bg-white text-zinc-950 shadow-lg' : 'text-zinc-600'}`}
                >
                  Tasks
                </button>
                <button 
                  onClick={() => setTasksView('routines')}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${tasksView === 'routines' ? 'bg-white text-zinc-950 shadow-lg' : 'text-zinc-600'}`}
                >
                  Routines
                </button>
              </div>

              {tasksView === 'tasks' ? (
                <>
                  <div className="flex justify-between items-center bg-zinc-950/20 p-4 rounded-3xl border border-white/5">
                    <div className="flex items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-blue-500" />
                       <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Daily tasks</h3>
                    </div>
                    <div className="text-[9px] font-bold text-zinc-600 bg-white/5 px-2 py-0.5 rounded-md">
                       {tasks.filter(t => !t.sourceTaskId).length}
                    </div>
                  </div>
                  {tasks.filter(t => !t.sourceTaskId).sort((a,b) => a.text.localeCompare(b.text)).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-20">
                      <LayoutGrid size={40} className="mb-4 text-zinc-700" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 text-center px-10">No concepts to schedule yet</p>
                    </div>
                  ) : (
                    tasks.filter(t => !t.sourceTaskId).sort((a,b) => a.text.localeCompare(b.text)).map(t => (
                    <TaskCard 
                      key={t.id} 
                      task={t} 
                      onToggle={() => toggleTask(t.id, t.completed)}
                      onDelete={() => deleteTask(t.id)}
                      onClick={() => setEditingTaskId(t.id)}
                      showSchedule
                      onSchedule={() => {
                        const date = new Date(2026, 4, selectedDay);
                        scheduleTask(t.id, date.toISOString());
                      }}
                      isUploading={isUploadingProof === t.id}
                    />
                    ))
                  )}
                </>
              ) : (
                <div className="space-y-6">
                  <div className="flex bg-zinc-900 border border-white/5 p-1.5 rounded-2xl">
                    {(['morning', 'evening'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => setActiveRoutineType(type)}
                        className={`flex-1 py-3 text-[11px] font-black uppercase tracking-[0.2em] rounded-xl transition-all ${activeRoutineType === type ? 'bg-zinc-800 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-400'}`}
                      >
                        {type === 'morning' ? 'Morning' : 'Evening'}
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-between items-center bg-zinc-950/20 p-4 rounded-3xl border border-white/5">
                    <div className="flex items-center gap-2">
                       <div className={`w-2.5 h-2.5 rounded-full ${activeRoutineType === 'morning' ? 'bg-orange-400' : 'bg-indigo-400'}`} />
                       <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                         {activeRoutineType === 'morning' ? 'Morning Routine' : 'Evening Routine'}
                       </h3>
                    </div>
                    <button 
                      onClick={() => setShowRoutinePicker(activeRoutineType)}
                      className="p-1.5 bg-blue-600/10 text-blue-400 rounded-lg hover:bg-blue-600/20 transition-all border border-blue-500/10 flex items-center gap-1.5 active:scale-95"
                    >
                      <Plus size={10} strokeWidth={3} />
                      <span className="text-[8px] font-bold uppercase tracking-wider">Task</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(() => {
                      const routine = routines.find(r => r.type === activeRoutineType);
                      if (!routine || (routine.taskIds || []).length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-20 opacity-20 text-center">
                            <Zap size={40} className="mb-4 text-zinc-700" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Routine is empty</p>
                            <p className="text-[9px] mt-2 text-zinc-500 font-bold uppercase">Add a task from library</p>
                          </div>
                        );
                      }
                      return (routine.taskIds || []).map((tid, index) => {
                        const task = tasks.find(t => t.id === tid);
                        if (!task) return null;
                        return (
                          <TaskCard 
                            key={`${tid}-${index}`}
                            task={task}
                            onToggle={() => {}} // No toggle in routine view, or maybe different action?
                            onDelete={async () => {
                              if (!user) return;
                              const newTaskIds = (routine.taskIds || []).filter(id => id !== tid);
                              await updateDoc(doc(db, 'routines', routine.id), { taskIds: newTaskIds, updatedAt: Date.now() });
                            }}
                            showSchedule={false}
                          />
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      {/* Routine Task Picker */}
      <AnimatePresence>
        {showRoutinePicker && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRoutinePicker(null)}
              className="fixed inset-0 z-[200] bg-zinc-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-x-0 bottom-0 z-[201] bg-zinc-900 border-t border-white/10 rounded-t-3xl shadow-[0_-20px_40px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] max-w-md mx-auto"
            >
              <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto my-6 shrink-0" />
              <div className="px-8 pb-6 flex justify-between items-center">
                <div>
                  <h2 className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-500">Pick to Routine</h2>
                  <p className="text-sm font-bold text-white tracking-tight">Task library</p>
                </div>
                <button 
                  onClick={() => setShowRoutinePicker(null)}
                  className="p-2.5 bg-white/5 rounded-2xl text-zinc-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto px-6 pb-12 space-y-2 custom-scrollbar">
                {tasks.filter(t => !t.sourceTaskId).sort((a,b) => a.text.localeCompare(b.text)).map(t => (
                  <button
                    key={t.id}
                    onClick={async () => {
                      if (!user) return;
                      const routine = routines.find(r => r.type === showRoutinePicker);
                      
                      if (routine) {
                        const newTaskIds = [...(routine.taskIds || [])];
                        if (!newTaskIds.includes(t.id)) {
                          newTaskIds.push(t.id);
                        }
                        try {
                          await updateDoc(doc(db, 'routines', routine.id), {
                            taskIds: newTaskIds,
                            updatedAt: Date.now()
                          });
                          playSuccessSound();
                        } catch (e) {
                          handleFirestoreError(e, OperationType.UPDATE, `routines/${routine.id}`);
                        }
                      } else {
                        // Create routine on the fly if seeder hasn't finished
                        try {
                          await addDoc(collection(db, 'routines'), {
                            userId: user.uid,
                            type: showRoutinePicker!,
                            taskIds: [t.id],
                            updatedAt: Date.now()
                          });
                          playSuccessSound();
                        } catch (e) {
                          handleFirestoreError(e, OperationType.CREATE, 'routines');
                        }
                      }
                      setShowRoutinePicker(null);
                    }}
                    className="w-full text-left p-4 rounded-2xl bg-zinc-800/40 hover:bg-blue-600/10 border border-white/5 hover:border-blue-500/20 transition-all group flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-zinc-100 group-hover:text-white transition-colors">{t.text}</p>
                      {t.description && <p className="text-[9px] text-zinc-500 mt-0.5 truncate">{t.description}</p>}
                    </div>
                    <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-blue-600 transition-all">
                      <Plus size={16} className="text-zinc-600 group-hover:text-white" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

        {/* Chat Overlay */}
        <AnimatePresence>
          {isChatMode && (
            <motion.div 
              layout
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ 
                opacity: 1, 
                y: 0,
                scale: 1,
                borderRadius: showFullChat ? "0px" : "2rem",
                top: showFullChat ? 0 : "auto",
                bottom: showFullChat ? 0 : 112,
                left: showFullChat ? 0 : 12,
                right: showFullChat ? 0 : 12,
              }}
              transition={{ 
                type: "spring", 
                damping: 30, 
                stiffness: 250,
                mass: 0.8
              }}
              exit={{ opacity: 0, y: 30, scale: 0.95 }}
              onClick={() => !showFullChat && setShowFullChat(true)}
              className={`fixed z-40 flex flex-col shadow-[0_40px_100px_rgba(0,0,0,0.95)] overflow-hidden cursor-pointer transition-colors duration-500 border border-white/5 ${showFullChat ? 'bg-zinc-950/98' : 'bg-zinc-900/90 backdrop-blur-3xl'}`}
              style={{ maxHeight: showFullChat ? "100vh" : "55vh" }}
            >
              {/* Header inside card */}
              <div className={`flex justify-between items-center shrink-0 transition-all duration-500 z-10 ${showFullChat ? 'px-8 pt-16 pb-6 border-b border-white/5 bg-zinc-950' : 'px-6 py-4'}`}>
                <motion.div layout className="flex items-center gap-2">
                  <motion.div 
                    layout
                    className={`rounded-xl bg-blue-600 flex items-center justify-center transition-all duration-500 shadow-lg shadow-blue-500/20 ${showFullChat ? 'w-9 h-9' : 'w-6 h-6'}`}
                  >
                    <Zap size={showFullChat ? 18 : 12} className="text-white fill-current" />
                  </motion.div>
                  <motion.span layout className={`font-semibold text-white/90 transition-all duration-500 ${showFullChat ? 'text-lg tracking-tight' : 'text-xs tracking-wide'}`}>
                    Shate
                  </motion.span>
                </motion.div>
                <div className="flex gap-2">
                  {showFullChat && (
                    <>
                      <button 
                        onClick={() => setShowHistory(true)}
                        className="p-2.5 hover:bg-white/5 rounded-xl text-blue-400 border border-white/5 bg-white/5 transition-all flex items-center gap-2"
                        title="All conversations"
                      >
                        <History size={18} />
                        <span className="text-[10px] font-bold uppercase tracking-tight hidden sm:block">History</span>
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setShowFullChat(false); }}
                        className="p-2.5 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white transition-all bg-white/5"
                      >
                        <X size={20} />
                      </button>
                    </>
                  )}
                  {!showFullChat && (
                    <div className="flex gap-2 items-center">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setShowHistory(true); }}
                        className="p-2 hover:bg-white/10 rounded-xl text-zinc-500 hover:text-white transition-all bg-white/5 border border-white/10"
                        title="Historie"
                      >
                        <History size={16} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setIsChatMode(false); }}
                        className="p-2 hover:bg-white/10 rounded-xl text-zinc-500 hover:text-white transition-all"
                        title="Close"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

                <div className={`flex-1 overflow-y-auto custom-scrollbar ${showFullChat ? 'px-8 py-10' : 'px-6 py-4'} flex flex-col`} ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center opacity-10 py-12 text-center">
                    <History size={40} className="mb-3 text-white" />
                    <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white">Start a conversation</p>
                  </div>
                ) : (
                <div className={`space-y-6 ${showFullChat ? 'pb-44' : 'pb-2'}`}>
                  {(showFullChat ? messages : (() => {
                    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
                    return lastUserIdx !== -1 ? messages.slice(messages.length - 1 - lastUserIdx) : messages.slice(-1);
                  })()).map((m, idx, arr) => (
                    <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} gap-2`}>
                      {m.role === 'user' ? (
                        <div className="max-w-[90%] self-end">
                          <div className={`px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-[13px] font-medium text-zinc-300 shadow-sm transition-all duration-300 ${(!showFullChat && !expandedUserMsg) ? 'truncate max-w-[280px]' : 'w-full whitespace-pre-wrap'}`}>
                            {m.content}
                          </div>
                        </div>
                      ) : (
                        <div className="w-full relative group">
                          <motion.div 
                            initial={idx === arr.length - 1 ? { opacity: 0, y: 10 } : false}
                            animate={{ opacity: 1, y: 0 }}
                            className={`text-[15px] sm:text-[16px] font-medium leading-relaxed text-white prose prose-invert max-w-none antialiased ${showFullChat ? 'tracking-normal' : 'tracking-tight'}`}
                          >
                            {isSpeaking && m.role === 'assistant' && idx === arr.length - 1 && currentSpeakingText ? (
                              <div className="text-[15px] sm:text-[16px] font-medium leading-relaxed text-zinc-100 whitespace-pre-wrap">
                                {currentSpeakingText.split(/(\s+)/).map((word, wordIdx, wordsArr) => {
                                  // Reconstruct character range for this word token
                                  const charOffset = wordsArr.slice(0, wordIdx).join('').length;
                                  // Cumulative highlighting: highlight everything before the current word's end
                                  const isHighlighted = spokenWordRange && 
                                    charOffset < spokenWordRange.end;
                                  
                                  return (
                                    <span 
                                      key={wordIdx} 
                                      className={`transition-colors duration-200 inline ${isHighlighted ? 'text-blue-400' : 'text-zinc-50/40'}`}
                                    >
                                      {word}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <Markdown>{m.content}</Markdown>
                            )}
                          </motion.div>

                          {m.suggestedTask && (
                            <motion.div 
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              className="mt-4 w-full max-w-sm"
                            >
                              <div className={`p-4 rounded-2xl border transition-all ${m.suggestedTask.status === 'added' ? 'bg-zinc-800/20 border-green-500/20' : 'bg-blue-600/5 border-blue-500/20 shadow-lg shadow-blue-500/5'}`}>
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div className={`w-2 h-2 rounded-full ${m.suggestedTask.status === 'added' ? 'bg-green-500' : 'bg-blue-500 animate-pulse'}`} />
                                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Suggested task</span>
                                    </div>
                                    <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-white' : 'text-zinc-900'} truncate`}>{m.suggestedTask.text}</h4>
                                    {m.suggestedTask.description && (
                                      <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{m.suggestedTask.description}</p>
                                    )}
                                  </div>
                                  {m.suggestedTask.status === 'suggested' && (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleAddSuggestedTask(m.id, m.suggestedTask!); }}
                                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center gap-2 shrink-0"
                                    >
                                      <Plus size={14} />
                                      ADD
                                    </button>
                                  )}
                                  {m.suggestedTask.status === 'added' && (
                                    <div className="flex items-center gap-2 text-green-500 font-bold text-[10px] uppercase tracking-widest bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20 shrink-0">
                                      <Check size={12} />
                                      ADDED
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                          
                          {/* Replay Button - Bottom Right */}
                          <div className="absolute bottom-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              onClick={() => speak(m.content)}
                              className="p-1 w-6 h-6 bg-zinc-900 border border-white/10 rounded-lg text-zinc-500 hover:text-white shadow-xl flex items-center justify-center"
                              title="Play again"
                            >
                              <Volume2 size={10} />
                            </motion.button>
                          </div>
                        </div>
                      )}
                      {idx === arr.length - 1 && isTyping && (
                        <div className="flex flex-col gap-1 pt-2">
                          <AnimatePresence>
                            {isSearching && (
                              <motion.div 
                                initial={{ opacity: 0, x: -5 }} 
                                animate={{ opacity: 0.6, x: 0 }} 
                                exit={{ opacity: 0 }}
                                className="text-[9px] uppercase font-black tracking-widest text-blue-400 flex items-center gap-1.5 ml-1 mb-1"
                              >
                                <Search size={8} /> 
                                Searching...
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <div className="flex space-x-2 items-center ml-1">
                            {[0, 0.2, 0.4].map(d => (
                              <motion.div key={d} animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }} transition={{ repeat: Infinity, duration: 1.2, delay: d }} className="w-1.5 h-1.5 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)] rounded-full" />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {/* Live Transcription in Small Mode */}
                  {!showFullChat && isRecording && inputText && (
                    <motion.div 
                      key="live-transcription"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-[90%] self-end"
                    >
                      <div className="px-4 py-2.5 rounded-2xl bg-white/5 border border-blue-500/30 text-[13px] font-medium text-blue-400/80 italic shadow-sm">
                        {inputText}...
                      </div>
                    </motion.div>
                  )}
                </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Removed redundant Full Chat History View */}
      
      {/* Morphing Bottom Bar - ABSOLUTE POSITION (inside mockup) */}
      {!showSettings && (
        <div className="absolute lg:absolute bottom-0 left-0 right-0 px-6 pt-4 pb-12 safe-area-bottom z-50 pointer-events-auto mx-auto max-w-md lg:max-w-none">
        <div className="flex items-center gap-3 w-full relative h-14">
          <AnimatePresence mode="wait" initial={false}>
            {!isChatMode ? (
              <motion.div 
                key="nav"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex-1 flex justify-center items-center h-14"
              >
                <div className="flex bg-white/[0.04] backdrop-blur-md rounded-[2rem] border border-white/5 p-1.5 gap-1.5 shadow-2xl">
                  {[
                    { id: 'explore', icon: Compass, label: 'Explore' },
                    { id: 'today', icon: Calendar, label: 'Today' },
                    { id: 'tasks', icon: LayoutGrid, label: 'Tasks' }
                  ].map((item) => (
                    <button 
                      key={item.id}
                      onClick={() => setActiveTab(item.id as any)}
                      className={`relative px-6 py-2 flex flex-col items-center justify-center transition-all group z-10 ${activeTab === item.id ? 'text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {activeTab === item.id && (
                        <motion.div 
                          layoutId="active-nav-pill"
                          className="absolute inset-0 bg-white rounded-2xl shadow-xl shadow-white/20"
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                      <div className="relative z-20 flex flex-col items-center">
                        <item.icon size={16} strokeWidth={activeTab === item.id ? 2.5 : 2} className="transition-transform duration-300 group-active:scale-90" />
                        <span className="text-[7px] font-black uppercase mt-1 tracking-widest leading-none">{item.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="chat-input-group"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex-1 flex items-center gap-2 h-14"
              >
                {/* Text Field */}
                <div className="flex-1 h-full bg-zinc-900/80 border border-white/5 rounded-2xl px-5 flex items-center shadow-inner relative">
                  {/* Voice Visualizer */}
                  <AnimatePresence>
                    {isRecording && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute -top-6 left-6 flex items-end gap-0.5 h-4"
                      >
                        {voiceAmplitude.map((h, i) => (
                          <motion.div 
                            key={i}
                            animate={{ height: `${4 + (h * 0.12)}px` }}
                            className="w-1 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50"
                          />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <input 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Message Shate..."
                    className="w-full bg-transparent text-sm focus:outline-none placeholder:text-zinc-600 font-bold transition-all"
                  />
                </div>

                {/* Send Button */}
                <div className="relative h-full">
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.preventDefault();
                      if (inputText.trim()) {
                        handleSend();
                      }
                    }}
                    disabled={!inputText.trim()}
                    className={`w-14 h-full rounded-2xl flex items-center justify-center transition-all shadow-xl shadow-black/20 relative overflow-hidden z-10 ${
                      inputText.trim() 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-zinc-900 text-zinc-700 border border-white/5 opacity-50'
                    }`}
                  >
                    <Send size={20} />
                  </motion.button>
                </div>
            </motion.div>
          )}
        </AnimatePresence>

          {/* Control Cluster */}
          <div className="relative w-14 h-14 flex flex-col items-center">
            {/* Plus button absolutely positioned above Zap */}
            <AnimatePresence>
              {!isChatMode && activeTab === 'tasks' && (
                <motion.button
                  initial={{ scale: 0, y: 10, opacity: 0 }}
                  animate={{ scale: 1, y: -64, opacity: 1 }}
                  exit={{ scale: 0, y: 10, opacity: 0 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setTaskDrawerStep('name');
                    setShowTaskDrawer(true);
                    setNewTaskTitle('');
                    setNewTaskDesc('');
                    setNewTaskType('normal');
                    setNewTaskQuestion('');
                    setNewTaskSchedule(null);
                  }}
                  className="absolute w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl shadow-black/40 bg-zinc-900 border border-white/10 text-white hover:bg-zinc-800 transition-colors"
                >
                  <Plus size={24} strokeWidth={3} />
                </motion.button>
              )}
            </AnimatePresence>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setIsChatMode(!isChatMode)}
              className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-all shadow-xl shadow-black/40 ${
                isChatMode ? 'bg-zinc-800 text-zinc-400' : 'bg-white text-zinc-950'
              }`}
            >
              <AnimatePresence mode="wait">
                {isChatMode ? (
                  <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
                    <X size={24} strokeWidth={2.5} />
                  </motion.div>
                ) : (
                  <motion.div key="open" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                    <Zap size={24} className="fill-current" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </div>
      )}

      {/* Proof Submission Drawer */}
      <AnimatePresence>
        {proofTask && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isUploadingProof && setProofTask(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-xl z-[150]"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-zinc-950 border-t border-white/10 rounded-t-[3rem] p-8 pb-12 z-[151] shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto mb-8" />
              
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                  <Zap size={32} className="text-blue-400 fill-current" />
                </div>
                <h2 className="text-[14px] font-black uppercase tracking-[0.4em] text-white">PROVE IT</h2>
                <p className="text-[11px] text-zinc-500 font-bold uppercase mt-2 px-8 leading-relaxed">
                  {proofTask.text}
                </p>
              </div>

              <div className="space-y-4">
                <div className="relative group">
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) submitProof(file);
                    }}
                    disabled={!!isUploadingProof}
                  />
                  <div className={`w-full h-48 rounded-[2rem] border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all ${isUploadingProof ? 'bg-zinc-900 border-zinc-800' : 'bg-white/5 border-white/10 group-hover:border-blue-500/50 group-hover:bg-blue-500/5'}`}>
                    {isUploadingProof ? (
                      <>
                        <motion.div 
                          animate={{ rotate: 360 }} 
                          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                          className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full"
                        />
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 animate-pulse">Analyzing proof...</p>
                      </>
                    ) : (
                      <>
                        <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-zinc-400 group-hover:text-blue-400 group-hover:scale-110 transition-all">
                          <Plus size={24} />
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Capture or select photo</p>
                      </>
                    )}
                  </div>
                </div>

                <button 
                  disabled={!!isUploadingProof}
                  onClick={() => setProofTask(null)}
                  className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-zinc-600 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Task Creation Bottom Sheet */}
      <AnimatePresence>
        {editingTaskId && tempEditingTask && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingTaskId(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100]"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-zinc-950 border-t border-white/10 rounded-t-[3rem] p-8 pb-12 z-[101] shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-zinc-800 rounded-full mx-auto mb-8" />
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[12px] font-black uppercase tracking-[0.3em] text-blue-500">Edit Task</h2>
                <button onClick={() => setEditingTaskId(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X size={20} className="text-zinc-500" />
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 pl-4">Task name</p>
                  <input 
                    type="text"
                    value={tempEditingTask.text}
                    onChange={(e) => setTempEditingTask({...tempEditingTask, text: e.target.value})}
                    className="w-full bg-white/[0.02] border border-white/5 rounded-2xl p-4 text-zinc-100 text-[13px] font-bold focus:outline-none focus:border-blue-500/30"
                  />
                </div>

                <button 
                  onClick={() => setTempEditingTask({...tempEditingTask, proofRequired: !tempEditingTask.proofRequired})}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${tempEditingTask.proofRequired ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/5 border-white/5'}`}
                >
                  <div className="flex items-center gap-3">
                    <Zap size={16} className={tempEditingTask.proofRequired ? 'text-blue-400' : 'text-zinc-600'} />
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white">PROVE IT</p>
                      <p className="text-[9px] text-zinc-500 font-bold uppercase mt-0.5 whitespace-nowrap">Require photo for completion</p>
                    </div>
                  </div>
                  <div className={`w-10 h-6 rounded-full p-1 transition-all ${tempEditingTask.proofRequired ? 'bg-blue-600' : 'bg-zinc-800'}`}>
                    <motion.div 
                      animate={{ x: tempEditingTask.proofRequired ? 16 : 0 }}
                      className="w-4 h-4 bg-white rounded-full shadow-lg" 
                    />
                  </div>
                </button>

                {tempEditingTask.audioUrl && (
                  <button 
                    onClick={() => playAudio(tempEditingTask.audioUrl!)}
                    className="w-full p-4 bg-blue-600/10 border border-blue-600/20 rounded-2xl flex items-center justify-center gap-3 text-blue-400 font-black text-[10px] uppercase tracking-widest hover:bg-blue-600/20 transition-all border-dashed"
                  >
                    <Volume2 size={16} />
                    Play audio commentary
                  </button>
                )}

                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      updateTask(tempEditingTask.id, {
                        text: tempEditingTask.text,
                        proofRequired: tempEditingTask.proofRequired
                      });
                      setEditingTaskId(null);
                    }}
                    className="flex-1 h-14 bg-white text-zinc-950 text-[11px] font-black uppercase tracking-[0.3em] rounded-2xl shadow-xl active:scale-95 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => {
                      deleteTask(tempEditingTask.id);
                      setEditingTaskId(null);
                    }}
                    className="w-14 h-14 bg-red-500/10 border border-red-500/20 flex items-center justify-center rounded-2xl text-red-500 hover:bg-red-500/20 transition-all active:scale-95"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTaskDrawer && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTaskDrawer(false)}
              className="fixed inset-0 z-[210] bg-zinc-950/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              onClick={(e) => e.stopPropagation()}
              transition={{ type: "spring", damping: 35, stiffness: 350 }}
              className="fixed bottom-0 left-0 right-0 z-[211] bg-zinc-950 border-t border-white/10 rounded-t-3xl shadow-[0_-20px_60px_rgba(0,0,0,0.6)] p-6 pb-12"
            >
              <div className="flex justify-between items-center mb-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <Zap size={20} className="text-white fill-current" />
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-white">Shate Concept</h2>
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Create a new idea</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowTaskDrawer(false)}
                  className="p-2.5 hover:bg-white/5 rounded-xl transition-all text-zinc-600 hover:text-white border border-white/5 bg-white/5"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <AnimatePresence mode="wait">
                  {taskDrawerStep === 'name' && (
                    <motion.div 
                      key="step-name"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                       <div className="space-y-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">STEP 1: TASK NAME</p>
                          <div className="relative group">
                            <div className="absolute left-4 top-4 text-zinc-700 group-focus-within:text-blue-500 transition-colors">
                              <Plus size={16} />
                            </div>
                            <input 
                              autoFocus
                              value={newTaskTitle}
                              onChange={(e) => setNewTaskTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTaskTitle.trim()) setTaskDrawerStep('type');
                              }}
                              placeholder="What needs to be done?"
                              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl p-4 pl-12 text-sm text-white placeholder:text-zinc-800 focus:outline-none focus:border-blue-500/30 transition-all font-bold tracking-tight"
                            />
                          </div>
                       </div>
                       <button 
                          disabled={!newTaskTitle.trim()}
                          onClick={() => setTaskDrawerStep('type')}
                          className="w-full h-12 bg-white text-zinc-950 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl shadow-xl active:scale-95 disabled:opacity-30 transition-all"
                        >
                          Continue
                        </button>
                    </motion.div>
                  )}

                  {taskDrawerStep === 'type' && (
                    <motion.div 
                      key="step-type"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                       <div className="space-y-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">STEP 2: ACTIVITY TYPE</p>
                          <div className="grid grid-cols-1 gap-2">
                            {[
                              { id: 'normal', label: 'Normal task', desc: 'Classic checklist task', icon: Check, color: 'text-blue-400' },
                              { id: 'prove_it', label: 'Photo verification', desc: 'Requires photo documentation', icon: Zap, color: 'text-orange-400' },
                              { id: 'text_input', label: 'Question', desc: 'Requires text answer', icon: MessagesSquare, color: 'text-purple-400' }
                            ].map(t => (
                              <button
                                key={t.id}
                                onClick={() => {
                                  setNewTaskType(t.id as 'normal' | 'prove_it' | 'text_input');
                                  setTaskDrawerStep('extras');
                                }}
                                className={`flex items-center gap-4 p-4 rounded-2xl border text-left transition-all ${newTaskType === t.id ? 'bg-blue-600/10 border-blue-500/40 shadow-lg shadow-blue-500/5' : 'bg-white/[0.02] border-white/5 hover:border-white/10'}`}
                              >
                                <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center ${t.color}`}>
                                  <t.icon size={18} />
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-white">{t.label}</p>
                                  <p className="text-[10px] text-zinc-500">{t.desc}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                       </div>
                       <button 
                          onClick={() => setTaskDrawerStep('name')}
                          className="w-full h-12 border border-white/5 text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:text-white transition-all"
                        >
                          Back
                        </button>
                    </motion.div>
                  )}

                  {taskDrawerStep === 'extras' && (
                    <motion.div 
                      key="step-extras"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                       <div className="space-y-5">
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600">STEP 3: DETAILS (OPTIONAL)</p>
                          
                          {newTaskType === 'text_input' && (
                            <div className="space-y-2">
                              <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1">Question for user</label>
                              <input 
                                value={newTaskQuestion}
                                onChange={(e) => setNewTaskQuestion(e.target.value)}
                                placeholder="What will Shate ask?"
                                className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs text-white placeholder:text-zinc-800 transition-all"
                              />
                            </div>
                          )}

                          <div className="space-y-2">
                            <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1">Task description</label>
                            <textarea 
                              value={newTaskDesc}
                              onChange={(e) => setNewTaskDesc(e.target.value)}
                              placeholder="More info..."
                              className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs text-zinc-400 h-20 resize-none"
                            />
                          </div>

                          <div className="space-y-3">
                            <label className="text-[9px] font-bold text-zinc-500 uppercase ml-1">Repeat & Calendar</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button 
                                onClick={() => setNewTaskSchedule({ type: 'daily' })}
                                className={`p-3 rounded-xl border text-[10px] font-bold transition-all ${newTaskSchedule?.type === 'daily' ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-white/5 border-white/5 text-zinc-500'}`}
                              >
                                Daily
                              </button>
                              <button 
                                onClick={() => setNewTaskSchedule(null)}
                                className={`p-3 rounded-xl border text-[10px] font-bold transition-all ${!newTaskSchedule ? 'bg-white/10 border-white/10 text-white' : 'bg-white/5 border-white/5 text-zinc-500'}`}
                              >
                                One-time
                              </button>
                            </div>
                         </div>
                       </div>

                       <div className="flex flex-col gap-3">
                         <button 
                            onClick={async () => {
                              const id = await addTask(newTaskTitle, newTaskDesc, '', newTaskType, newTaskQuestion);
                              if (id && newTaskSchedule) {
                                try {
                                  const { doc, updateDoc } = await import('firebase/firestore');
                                  await updateDoc(doc(db, 'tasks', id), { schedule: newTaskSchedule });
                                } catch (error) {
                                  console.error("Failed to update task schedule:", error);
                                }
                              }
                            }}
                            className="w-full h-12 bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl shadow-xl active:scale-95 transition-all"
                          >
                            Create task
                          </button>
                          <button 
                            onClick={() => setTaskDrawerStep('type')}
                            className="w-full h-12 border border-white/5 text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:text-white transition-all"
                          >
                            Back
                          </button>
                       </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
          </div>
        )}
      </div>

            {/* Home Indicator Mock (Desktop only) */}
            <div className="hidden lg:flex h-6 w-full items-center justify-center bg-transparent shrink-0">
               <div className="w-32 h-1.5 bg-zinc-800/50 rounded-full" />
            </div>
          </div>
        </div>

        {/* RIGHT: Login Panel (Desktop only) */}
        <div className="hidden lg:flex lg:w-1/4 xl:w-1/4 flex-col justify-center p-16">
          <div className={`p-10 rounded-[3rem] border shadow-2xl space-y-8 ${theme === 'dark' ? 'bg-zinc-900/40 border-white/5' : 'bg-white border-zinc-100'}`}>
            {!isAuthReady ? (
               <div className="flex flex-col items-center justify-center p-12 space-y-4">
                 <motion.div 
                   animate={{ rotate: 360 }} 
                   transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }} 
                   className="w-10 h-10 border-2 border-blue-500/20 border-t-blue-500 rounded-full" 
                 />
                 <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 animate-pulse">Checking Session</p>
               </div>
            ) : !user ? (
               <div className="space-y-6">
                  <div className="space-y-2">
                    <h2 className={`text-3xl font-black tracking-tight ${theme === 'dark' ? 'text-white' : 'text-zinc-950'}`}>Welcome</h2>
                    <p className="text-sm text-zinc-500 font-medium leading-relaxed">Log in to your account and start your day with a clear plan and Shate by your side.</p>
                  </div>
                  
                  <button 
                    onClick={login}
                    disabled={isLoggingIn}
                    className="w-full h-16 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-black uppercase tracking-[0.2em] flex items-center justify-center gap-4 shadow-xl shadow-blue-600/20 active:scale-[0.98] transition-all rounded-2xl text-[10px]"
                  >
                    <GoogleIcon />
                    {isLoggingIn ? 'Logging in...' : 'Sign in with Google'}
                  </button>
                  
                  <div className="pt-4 border-t border-white/5 flex items-center justify-center">
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Shate v1.2 • Gemini Powered</p>
                  </div>
               </div>
            ) : (
               <div className="space-y-8">
                  <div className="space-y-2">
                     <div className="flex items-center gap-2 text-emerald-500">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        <h2 className="text-xl font-black uppercase tracking-widest">Online</h2>
                     </div>
                     <p className="text-sm text-zinc-500 font-medium">You're synced. All your routines and tasks are safe.</p>
                  </div>

                  <div className={`p-6 rounded-[2rem] border ${theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-zinc-50 border-zinc-200'} flex items-center gap-4`}>
                    <div className="w-14 h-14 rounded-2xl bg-zinc-800 overflow-hidden border border-white/10 shrink-0 shadow-lg">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt="User" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500 font-black text-xl">
                          {user.displayName?.[0] || 'U'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-lg font-black truncate leading-tight ${theme === 'dark' ? 'text-white' : 'text-zinc-950'}`}>{user.displayName}</p>
                      <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest truncate mt-1">{user.email}</p>
                    </div>
                  </div>

                  <button 
                    onClick={logout}
                    className={`w-full h-14 border rounded-3xl transition-all active:scale-[0.98] text-[9px] flex items-center justify-center gap-3 font-black uppercase tracking-[0.2em] ${
                      theme === 'dark' ? 'bg-zinc-900 border-white/5 text-zinc-400 hover:text-white hover:bg-white/5' : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50'
                    }`}
                  >
                    <LogOut size={14} />
                    Log Out
                  </button>
               </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

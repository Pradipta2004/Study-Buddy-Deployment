'use client';

import { useState, useRef, useEffect } from 'react';
import QuestionCustomizer from '@/components/QuestionCustomizer';
import LatexPreview from '@/components/LatexPreview';

interface QuestionConfig {
  subject: string;
  questionTypes: string[];
  difficulty: string;
  studentClass: string;
  customInstructions?: string;
  questionsByType?: {
    mcq: number;
    fillInBlanks: number;
    trueFalse: number;
    columnMatching: number;
    general: number;
  };
  questionsByMarks?: {
    '2': number;
    '3': number;
    '4': number;
    '5': number;
    '6': number;
    '10': number;
  };
}

const MOTIVATIONAL_QUOTES = [
  "Every question = free XP for your brain. Level up! 🧠✨",
  "You’re building your main character arc today. Keep grinding 💪🔥",
  "Lock in. Focus mode = beast mode. 🎯😤",
  "Self-belief is your real superpower. Use it. ⚡😎",
  "Small wins still slap. Progress is progress. 🚀✨",
  "Knowledge = ultimate flex. Stack it up. 💎📚",
  "You’re lowkey capable of insane things. Don’t forget that 🚀😌",
  "Practice now, dominate later. That’s the formula. 📈🔥",
  "Your potential? Literally no limit detected. 🌌✨",
  "Mistakes are just plot twists in your success story 🎬🧠",
  "Prep hard, walk in confident. Easy combo 💡😎",
  "You’re stronger than your excuses. Facts. 💫🔥",
  "Success isn’t gifted — it’s earned. Go claim it 🏆⚡",
  "Don’t stop now… you’re THIS close 🤏🎉",
  "The effort you put in today will flex tomorrow 💪🌟",
  "Your glow-up is still loading… stay tuned ✨🌺",
  "Study now, future you will be obsessed with you 📖😌",
  "You’ve got main character energy. Use it ⚡🎬",
  "You’re way more capable than you think. No debate 🌟😤",
  "Consistency today = legendary results tomorrow 🛤️🔥",
];


const EXAM_QUOTES = [
  "You've prepared well. Trust yourself! 🎓",
  "Take a deep breath. You can do this! 💫",
  "Success is yours for the taking! 🏅",
];

const FEEDBACK_CLASSES = [
  'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8',
  'Class 9', 'Class 10', 'Class 11', 'Class 12', 'College/University',
];

const FEEDBACK_SUBJECTS = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology',
  'Physical Science', 'Life Science', 'English', 'History',
  'Geography', 'Economics', 'Computer Science', 'Environmental Science',
  'Political Science', 'Accountancy', 'Business Studies',
  'Psychology', 'Sociology', 'Physical Education',
  'Statistics', 'Engineering', 'Philosophy', 'Law',
  'Medical Science', 'Commerce',
];

// Cheatsheet subject options
const CHEATSHEET_SUBJECTS = [
  { value: 'mathematics', label: '📐 Mathematics' },
  { value: 'physics', label: '⚛️ Physics' },
  { value: 'chemistry', label: '🧪 Chemistry' },
  { value: 'biology', label: '🧬 Biology' },
  { value: 'physical-science', label: '⚛️ Physical Science' },
  { value: 'life-science', label: '🧬 Life Science' },
  { value: 'english', label: '📚 English' },
  { value: 'history', label: '📜 History' },
  { value: 'geography', label: '🗺️ Geography' },
  { value: 'economics', label: '💰 Economics' },
  { value: 'computer-science', label: '💻 Computer Science' },
  { value: 'environmental-science', label: '🌱 Environmental Science' },
  { value: 'political-science', label: '🏛️ Political Science' },
  { value: 'accountancy', label: '📊 Accountancy' },
  { value: 'business-studies', label: '💼 Business Studies' },
  { value: 'psychology', label: '🧠 Psychology' },
  { value: 'sociology', label: '👥 Sociology' },
  { value: 'statistics', label: '📈 Statistics' },
  { value: 'engineering', label: '⚙️ Engineering' },
  { value: 'commerce', label: '💳 Commerce' },
  { value: 'others', label: '📝 Others' },
];

const CHEATSHEET_CLASSES = [
  { value: '4', label: 'Class 4' },
  { value: '5', label: 'Class 5' },
  { value: '6', label: 'Class 6' },
  { value: '7', label: 'Class 7' },
  { value: '8', label: 'Class 8' },
  { value: '9', label: 'Class 9' },
  { value: '10', label: 'Class 10' },
  { value: '11', label: 'Class 11' },
  { value: '12', label: 'Class 12' },
  { value: 'college', label: 'College/University' },
];

export default function Home() {
  const [started, setStarted] = useState(false);
  const [activeFeature, setActiveFeature] = useState<'questions' | 'cheatsheet' | null>(null);
  const [mode, setMode] = useState<'pattern' | 'custom' | 'ai-magic' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [latexContent, setLatexContent] = useState('');
  const [isFromPattern, setIsFromPattern] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [currentQuote, setCurrentQuote] = useState('');
  const [generationComplete, setGenerationComplete] = useState(false);
  const [config, setConfig] = useState<QuestionConfig>({
    subject: 'mathematics',
    questionTypes: ['problem-solving', 'conceptual'],
    difficulty: 'mixed',
    studentClass: '10',
  });
  const [isDragging, setIsDragging] = useState(false);
  const [showCompleteSolutions, setShowCompleteSolutions] = useState(false);
  const [allQuestions, setAllQuestions] = useState<Array<{ number: number; question: string; solution: string }>>([]);

  // Cheatsheet state
  const [cheatsheetFile, setCheatsheetFile] = useState<File | null>(null);
  const [cheatsheetSubject, setCheatsheetSubject] = useState('mathematics');
  const [cheatsheetClass, setCheatsheetClass] = useState('10');
  const [cheatsheetLatex, setCheatsheetLatex] = useState('');
  const [cheatsheetLoading, setCheatsheetLoading] = useState(false);
  const [cheatsheetError, setCheatsheetError] = useState('');
  const [cheatsheetComplete, setCheatsheetComplete] = useState(false);
  const [cheatsheetProgress, setCheatsheetProgress] = useState(0);
  const [cheatsheetTokenUsage, setCheatsheetTokenUsage] = useState<{ promptTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  const cheatsheetFileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingCheatsheet, setIsDraggingCheatsheet] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ name: '', studentClass: '', subject: '', suggestions: '' });
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [tokenUsage, setTokenUsage] = useState<{ extraction: { promptTokens: number; outputTokens: number; totalTokens: number }; pattern: { promptTokens: number; outputTokens: number; totalTokens: number }; generation: { promptTokens: number; outputTokens: number; totalTokens: number }; total: { promptTokens: number; outputTokens: number; totalTokens: number } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patternFileInputRef = useRef<HTMLInputElement>(null);
  const quoteIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const modalPreviewRef = useRef<HTMLDivElement>(null);
  const [wasTabHidden, setWasTabHidden] = useState(false);

  // Track tab visibility during generation
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (loading && document.hidden) {
        setWasTabHidden(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loading]);

  // Show alert with sound when generation completes while tab was hidden
  useEffect(() => {
    if (generationComplete && wasTabHidden && !loading) {
      // Play notification sound
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+Hpw3QlBSl+zPDeijwIEF+y6OysWhIMUKvj78N3Jgk0idDz0IlCCBVhs+nprV8VDFGv5fHEeSgGNYvR89SUTg4XZLXn6K5kFQ1To+X0xH4qBjmO0/TVmVIQG2O26+ynZBYOVKnk88aAKwc4jdT01aFWER1ltuvsrGoYD1Ks5PPGgS0HOI/U9talWhEmabzr8bBuGRJUr+X0xYEuBjiP1PXXq18VJ2y87fKxcBkSVrDl9caEMAg4kdX33LFdFCpuve7ytHEaE1iy5vbHhjAHOJLW992yXxUrb7/v87VyGhVasuX2yIgwBTmS1vjdr2AcLnTB8PW1choVW7Pn9ciIMQc5kdX33bJgHS91wfD1tnIaFVy06PfJiTAHOJHW+N6zYR4xdsMf9rcyHBVavOr3yYkxBjiP1/jftWIgMXjE//a6Mx0VXL7s+cqLMQU3j9f44bhhITJ5xv/2uzMeFV7A7PnLizEFNo/Y+eK5YyQzesb/9rwzHhVew+37y4wxBTaP2Prju2UnNHzH//a+NB4VXsTt+8yNMgU1kNj64r1nKDV8yP/2vzUeFV3F7vvMjTIFNZDZ+uO+airWfsn/9sA0HxZexu/8zY4yBjSQ2frjv2sr1n/K//bBNR4WXsfw/c2OMgY0kNr74r9sK9WBy//2wTQeFl7I8f3OjzMGMpDb++PALNS/y//2wjUfFl7J8//OjzMHMZDb++HBLdXAzP/2wjYfF13K8//PkDMHMZDc++HBLdXBzf/2wjYgF13K9P/QkDMHMZDc/OLCLtTBzf/2wTUgGF3L9P/RkTQGMJDc/OPDLtPCzf/2wTUfGF3M9f/SkjQGMI/d/OPELtLCzv/2wDQhGF7N9v/Tk TQGMJDd/eTFLtHCz//2vzQhGV7N9v/TkzUFMY/e/eTFL8/C0P/xvjMiGV/O9//UlDUFMpDe/uXGMM7B0P/wvDMjGWDP+P/VlTUFMpDf/+bHMM3B0f/vuDImG2HQ+f/WlzYEMpDf/+fIMsyB0v/us zInG2HR+v/XmDYEMZDg/+jIMszA0//rrzIoHGHT/P/YmTcEM4/h/+jLM8u/1P/prDEnHGLU/P/ZmzcTMY/h/+rNM8nA1f/mrDIoHWPV/f/amzcEM4/h/+vNNMjA1v/jqzMpHWTV/f/bnDcEM5Dh/+zPNMfB1//hqDQpHmXW/v/cnTgEMZDi/+3PNcXB2P/epzUrH2bbAP/doDgFMZDi/+7QNMTB2f/cpDUrIWjcAP/fojkGMJDi/+/RNMPh2//aozYsImndAf/gpDkGMJDj//DRNsPh3f/XojctI2rfAv/hpToGMJDj//LSNsHh3v/VoTguJGzfAv/ipzsGMJDk//PTNr/g4P/TnzkvJW3hA//kqDwGMJDk//TUNr7h4f/QnTkwJ2/iA//lqj0GMJDl//XUNrzh4//OnDkxKXDjBP/mrD4FMJDl//bVN7ri5P/MmzkxK3HkBf/nrj8GMJDm//fVN7ji5f/LmToxLHHlBf/osEAFMJDm//fWOLbi5//JmDoqLHLmBv/pskAFMJDn//jXOLXi6P/HlzorLnPnB//qtEEFMJDn//jXOLPh6f/GlTstL3PoB//ruUIFMJDo//nYObLh6v/ElT0uMHTpCP/suUMFMJDo//nYObDh6//ClD4vMHXqCf/tu0QFMJ Do//rZOrDh7P/BkjAvMHXrCf/uvEUFMI/p//vaOrDh7f+/kTEwMnbsCv/uvUUFL4/p//vbO67h7v++jzEwM3ftC//vv0YFL4/q//zbO67h7/+9jzIxM3juDP/wwUYFL4/q//zcPKzh8P+8jDIxNXnvDf/xwkcFL4/q//3dPKvh8f+6izIyNnrwDv/yxEgFL4/r//3dPKvh8v+5ijMyN3vxD//zxUgFL4/r//7ePanh8/+4iTM0OHz yD//0xkkFL4/s//7fPamh9P+3iTM1OHzzEP/0x0kFL4/s///fPaih9f+2iDM1OnD0EP/1yUoFL4/s///gPqih9v+1hzM2O3z1Ef/2yksFL4/s///gPqeg9/+0hjM3PHz2E//2y0sFL4/t///hPaWg+P+zhTM3PHzzEv/3zEwFL4/t///hPqWf+f+xhDM4PXz0E//3zU0FL4/u///iPqSf+v+whjQ5Pn31Ff/4zk0FL4/u///jP6Oe+/+vhTQ5P331Fv/5z04FL4/u///jP6Kd/P+ugjQ6P372F//50E4FL4/v///kP6Kd/P+tgjU7Qn73GP/60U8FL4/v///kQKGd/f+sgjU7Q374Gf/601AFL4/v///lQKCc/f+rgDU8RH75Gv/61FAFLo/00Y/w///lQJ+c/v+qfzU9RH76G//71VEFLo/w///mQZ+b/v+pfzY9RX77HP/816EFLo/w///mQp6b//+ofzc+h378Hf/72FIFLo/x///nQp6a///nfzc+Rn/9Hv/82VMFLo/x///n');
      audio.volume = 0.3;
      audio.play().catch(err => console.log('Audio play failed:', err));

      // Show alert
      setTimeout(() => {
        alert('✅ Question generation complete! Your questions are ready.');
        setWasTabHidden(false);
      }, 100);
    }
  }, [generationComplete, wasTabHidden, loading]);

  // Convert LaTeX content to HTML-friendly format
  const formatContent = (latex: string) => {
    // Remove LaTeX comments and metadata lines
    let formatted = latex
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // Remove lines that start with % (comments)
        if (trimmed.startsWith('%')) return false;
        // Remove lines that look like OCR artifacts or metadata
        if (trimmed.match(/^%\s*(For|Adjusted|No rule|Rule|Small space|Clear all|To fit|Apply|Various)/i)) return false;
        return true;
      })
      .join('\n');
    
    // Remove documentclass and preamble for preview
    formatted = formatted
      .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .replace(/\\geometry\{[^}]*\}/g, '')
      .replace(/\\pagestyle\{[^}]*\}/g, '')
      .replace(/\\setlength\{[^}]*\}\{[^}]*\}/g, '')
      .replace(/\\addtolength\{[^}]*\}\{[^}]*\}/g, '')
      .replace(/\\fancyhf\{\}/g, '')
      .replace(/\\fancyhead\[[^\]]*\]\{[^}]*\}/g, '')
      .replace(/\\fancyfoot\[[^\]]*\]\{[^}]*\}/g, '')
      .replace(/\\begin\{document\}/g, '')
      .replace(/\\end\{document\}/g, '')
      .replace(/\\maketitle/g, '')
      .replace(/\\title\{([^}]*)\}/g, '')
      .replace(/\\author\{([^}]*)\}/g, '')
      .replace(/\\date\{([^}]*)\}/g, '')
      .replace(/\\noindent/g, '')
      .replace(/\\centering/g, '')
      .replace(/\\phantom\{[^}]*\}/g, '')
      .replace(/\\dimexpr[^}]*\\fboxsep[^}]*\\fboxrule/g, '100%')
      .replace(/\\vspace\{[^}]*\}/g, '<div class="my-4"></div>')
      // Handle fill-in-the-blank pattern BEFORE processing standalone hspace and underline
      .replace(/\\underline\{\\hspace\{([^}]+)\}\}/g, (match, size) => {
        const numMatch = size.match(/([\d.]+)/);
        const num = numMatch ? parseFloat(numMatch[1]) : 2;
        const pixels = Math.max(num * 37.8, 80);
        return `<span class="inline-block border-b-2 border-gray-800" style="width: ${pixels}px; min-width: 80px; height: 1.5em; vertical-align: bottom;"></span>`;
      })
      .replace(/\\hspace\{[^}]*\}/g, '<span class="inline-block w-4"></span>')
      .replace(/\\newpage/g, '<div class="border-t-2 border-gray-300 my-8"></div>');

    // Convert center environment
    formatted = formatted
      .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div class="text-center">$1</div>');

    // Convert fbox and parbox
    formatted = formatted
      .replace(/\\fbox\{\\parbox\{[^}]*\}\{([\s\S]*?)\}\}/g, (match, content) => {
        const processed = content
          .replace(/\\begin\{itemize\}\[leftmargin=\*,?\s*itemsep=[^\]]*\]/g, '<ul class="list-disc ml-5 space-y-0.5 my-2">')
          .replace(/\\begin\{itemize\}\[itemsep=[^\]]*\]/g, '<ul class="list-disc ml-5 space-y-0.5 my-2">')
          .replace(/\\begin\{itemize\}/g, '<ul class="list-disc ml-5 space-y-1 my-2">');
        return `<div class="border-2 border-black p-4 my-6 bg-white">${processed}</div>`;
      })
      .replace(/\\fbox\{([\s\S]*?)\}/g, '<div class="border-2 border-gray-800 p-4 rounded-md inline-block">$1</div>');

    // Convert rules and lines
    formatted = formatted
      .replace(/\\rule\{[^}]*\}\{[^}]*\}/g, '<hr class="border-t-2 border-gray-400 my-2" />');

    // Convert sections
    formatted = formatted
      .replace(/\\section\*\{([^}]*)\}/g, '<h2 class="text-2xl font-bold mt-8 mb-4 text-purple-700">$1</h2>')
      .replace(/\\subsection\*\{([^}]*)\}/g, '<h3 class="text-xl font-semibold mt-6 mb-3 text-indigo-600">$1</h3>')
      .replace(/\\section\{([^}]*)\}/g, '<h2 class="text-2xl font-bold mt-8 mb-4 text-purple-700">$1</h2>')
      .replace(/\\subsection\{([^}]*)\}/g, '<h3 class="text-xl font-semibold mt-6 mb-3 text-indigo-600">$1</h3>');

    // Convert font sizes
    formatted = formatted
      .replace(/\{\\Large\s+(.*?)\}/g, '<span class="text-2xl">$1</span>')
      .replace(/\{\\large\s+(.*?)\}/g, '<span class="text-xl">$1</span>')
      .replace(/\{\\small\s+(.*?)\}/g, '<span class="text-sm">$1</span>')
      .replace(/\{\\tiny\s+(.*?)\}/g, '<span class="text-xs">$1</span>');

    // Convert lists
    formatted = formatted
      .replace(/\\begin\{itemize\}(?:\[[^\]]*\])?/g, '<ul class="list-disc ml-6 my-3 space-y-1">')
      .replace(/\\end\{itemize\}/g, '</ul>')
      .replace(/\\begin\{enumerate\}(?:\[[^\]]*\])?/g, '<ol class="list-decimal ml-6 my-3 space-y-1">')
      .replace(/\\end\{enumerate\}/g, '</ol>')
      .replace(/\\item(?:\s*\[[^\]]*\])?/g, '<li class="ml-0 pl-1">');

    // Convert text formatting
    formatted = formatted
      .replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>')
      .replace(/\\emph\{([^}]*)\}/g, '<em>$1</em>')
      .replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');

    // Convert line breaks
    formatted = formatted
      .replace(/\\\\\[?[^\]]*\]?/g, '<br/>')
      .replace(/\\newline/g, '<br/>');

    // Handle special characters
    formatted = formatted
      .replace(/\\&/g, '&')
      .replace(/\\%/g, '%')
      .replace(/\\#/g, '#')
      .replace(/\\_(?![^$]*\$)/g, '_');
    
    // Handle additional LaTeX commands
    formatted = formatted
      .replace(/\\bigskip/g, '<div class="my-6"></div>')
      .replace(/\\medskip/g, '<div class="my-4"></div>')
      .replace(/\\smallskip/g, '<div class="my-2"></div>')
      .replace(/\\quad/g, '<span class="inline-block w-8"></span>')
      .replace(/\\qquad/g, '<span class="inline-block w-16"></span>')
      .replace(/\\par\s*/g, '</p><p class="my-4">');

    // Add paragraph breaks for double newlines
    formatted = formatted
      .split('\n\n')
      .map(para => para.trim())
      .filter(para => para.length > 0 && !para.match(/^<[^>]+>$/))
      .map(para => {
        if (para.match(/^<(div|h[1-6]|ul|ol|hr)/)) {
          return para;
        }
        return `<p class="my-4">${para}</p>`;
      })
      .join('\n');

    return formatted;
  };

  // KaTeX rendering for the modal
  useEffect(() => {
    if (showCompleteSolutions && allQuestions.length > 0 && modalPreviewRef.current) {
      const renderMath = () => {
        try {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
          script.onload = () => {
            const script2 = document.createElement('script');
            script2.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';
            script2.onload = () => {
              if (modalPreviewRef.current && (window as any).renderMathInElement) {
                (window as any).renderMathInElement(modalPreviewRef.current, {
                  delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false }
                  ],
                  throwOnError: false
                });
              }
            };
            document.head.appendChild(script2);
          };
          document.head.appendChild(script);
        } catch (error) {
          console.error('KaTeX rendering error:', error);
        }
      };

      setTimeout(renderMath, 100);
    }
  }, [showCompleteSolutions, allQuestions]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setFile(selectedFile);
        setError('');
      } else {
        setError('Please select a PDF file');
      }
    }
  };

  const handlePatternFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setPatternFile(selectedFile);
        setError('');
      } else {
        setError('Please select a PDF file for the pattern');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
        setError('');
      } else {
        setError('Please drop a PDF file');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setGenerationComplete(false);
    setError('');
    setLatexContent('');
    setIsFromPattern(!!patternFile);
    setLoadingProgress(0);

    // Start quote rotation
    setCurrentQuote(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);
    if (quoteIntervalRef.current) clearInterval(quoteIntervalRef.current);
    quoteIntervalRef.current = setInterval(() => {
      setCurrentQuote(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);
    }, 3000);

    // Start progress animation
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let progress = 0;
    progressIntervalRef.current = setInterval(() => {
      progress += Math.random() * 25;
      if (progress > 90) progress = 90;
      setLoadingProgress(Math.min(progress, 90));
    }, 500);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (patternFile) {
        formData.append('patternFile', patternFile);
      }
      formData.append('subject', config.subject);
      config.questionTypes.forEach(type => {
        formData.append('questionTypes', type);
      });
      formData.append('difficulty', config.difficulty);
      formData.append('studentClass', config.studentClass);
      
      if (config.customInstructions) {
        formData.append('customInstructions', config.customInstructions);
      }
      
      if (config.questionsByType) {
        formData.append('questionsByType', JSON.stringify(config.questionsByType));
      }
      
      if (config.questionsByMarks) {
        formData.append('questionsByMarks', JSON.stringify(config.questionsByMarks));
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        // No explicit timeout signal, rely on browser/server timeout
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = 'Upload failed. Please try again.';
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If the response is HTML (like 504 Gateway Timeout), use a user-friendly message
          if (text.trim().startsWith('<')) {
            if (response.status === 504 || response.status === 408) {
              errorMessage = 'Request timed out. Try a smaller PDF or fewer questions.';
            } else if (response.status === 429) {
              errorMessage = 'Too many requests. Please wait 30 seconds and try again.';
            } else {
              errorMessage = `Server Error (${response.status}): The request timed out or failed. Please try again.`;
            }
          } else {
            errorMessage = text || errorMessage;
          }
        }
        throw new Error(errorMessage);
      }

      const text = await response.text();
      if (!text) {
        throw new Error('Empty response from server');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error. Response text:', text.substring(0, 500));
        throw new Error('Invalid response from server. Please check server logs.');
      }

      if (!data.latex) {
        throw new Error('No LaTeX content received from server');
      }

      setLoadingProgress(100);
      setLatexContent(data.latex);
      if (data.tokenUsage) {
        setTokenUsage(data.tokenUsage);
      }
      setGenerationComplete(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred during upload');
    } finally {
      setLoading(false);
      if (quoteIntervalRef.current) clearInterval(quoteIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  };

  const handleDownloadLatex = async () => {
    try {
      setError(''); // Clear any previous errors
      const response = await fetch('/api/download-latex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ latex: latexContent }),
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `math_questions_${Date.now()}.tex`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackForm.name || !feedbackForm.studentClass || !feedbackForm.subject) {
      setFeedbackError('Please fill in name, class, and subject.');
      return;
    }
    setFeedbackLoading(true);
    setFeedbackError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedbackForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit');
      }
      setFeedbackSuccess(true);
      setFeedbackForm({ name: '', studentClass: '', subject: '', suggestions: '' });
      setTimeout(() => {
        setShowFeedbackForm(false);
        setFeedbackSuccess(false);
      }, 2000);
    } catch (err: any) {
      setFeedbackError(err.message || 'Something went wrong');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleResetAndGenerateAnother = () => {
    setLatexContent('');
    setGenerationComplete(false);
    setFile(null);
    setPatternFile(null);
    setMode(null);
    setStarted(false);
    setActiveFeature(null);
    setError('');
    setLoadingProgress(0);
    setTokenUsage(null);
    // Reset cheatsheet state too
    setCheatsheetFile(null);
    setCheatsheetLatex('');
    setCheatsheetComplete(false);
    setCheatsheetError('');
    setCheatsheetProgress(0);
    setCheatsheetTokenUsage(null);
  };

  // ===== CHEATSHEET HANDLERS =====
  const handleCheatsheetFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'application/pdf') {
        setCheatsheetFile(selectedFile);
        setCheatsheetError('');
      } else {
        setCheatsheetError('Please select a PDF file');
      }
    }
  };

  const handleCheatsheetDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCheatsheet(true);
  };

  const handleCheatsheetDragLeave = () => {
    setIsDraggingCheatsheet(false);
  };

  const handleCheatsheetDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCheatsheet(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setCheatsheetFile(droppedFile);
        setCheatsheetError('');
      } else {
        setCheatsheetError('Please drop a PDF file');
      }
    }
  };

  const handleGenerateCheatsheet = async () => {
    if (!cheatsheetFile) {
      setCheatsheetError('Please select a PDF file first');
      return;
    }

    setCheatsheetLoading(true);
    setCheatsheetError('');
    setCheatsheetLatex('');
    setCheatsheetComplete(false);
    setCheatsheetProgress(0);

    // Start quote rotation
    setCurrentQuote(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);
    if (quoteIntervalRef.current) clearInterval(quoteIntervalRef.current);
    quoteIntervalRef.current = setInterval(() => {
      setCurrentQuote(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);
    }, 3000);

    // Start progress animation
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    let progress = 0;
    progressIntervalRef.current = setInterval(() => {
      progress += Math.random() * 20;
      if (progress > 90) progress = 90;
      setCheatsheetProgress(Math.min(progress, 90));
    }, 600);

    try {
      const formData = new FormData();
      formData.append('file', cheatsheetFile);
      formData.append('subject', cheatsheetSubject);
      formData.append('studentClass', cheatsheetClass);

      const response = await fetch('/api/cheatsheet', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = 'Cheatsheet generation failed. Please try again.';
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.error || errorMessage;
        } catch {
          if (text.trim().startsWith('<')) {
            if (response.status === 504 || response.status === 408) {
              errorMessage = 'Request timed out. Try a smaller PDF.';
            } else {
              errorMessage = `Server Error (${response.status}). Please try again.`;
            }
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (!data.latex) {
        throw new Error('No cheatsheet content received from server');
      }

      setCheatsheetProgress(100);
      setCheatsheetLatex(data.latex);
      if (data.tokenUsage) {
        setCheatsheetTokenUsage(data.tokenUsage);
      }
      setCheatsheetComplete(true);
    } catch (err: any) {
      setCheatsheetError(err.message || 'An error occurred during cheatsheet generation');
    } finally {
      setCheatsheetLoading(false);
      if (quoteIntervalRef.current) clearInterval(quoteIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  };

  const handleDownloadCheatsheetPDF = async () => {
    try {
      setCheatsheetError('');
      setCheatsheetLoading(true);
      const response = await fetch('/api/download-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: cheatsheetLatex,
          includeSolutions: true, // no solutions to strip for cheatsheet
          subject: cheatsheetSubject,
          studentClass: cheatsheetClass,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'PDF generation failed');
      }

      const blob = await response.blob();
      const dateStr = new Date().toISOString().split('T')[0];
      const sanitizedSubject = cheatsheetSubject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = cheatsheetClass.replace(/[^a-z0-9]+/g, '');
      const filename = `cheatsheet_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

      // Detect mobile
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          const linkResponse = await fetch('/api/get-pdf-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBuffer: base64, filename }),
          });
          if (linkResponse.ok) {
            const { url } = await linkResponse.json();
            window.open(url, '_blank');
            setCheatsheetLoading(false);
            return;
          }
        } catch (linkErr) {
          console.log('Direct link method failed:', linkErr);
        }
        try {
          const reader = new FileReader();
          reader.onloadend = function() {
            const base64data = reader.result as string;
            const newWindow = window.open('', '_blank');
            if (newWindow) newWindow.location.href = base64data;
            else window.location.href = base64data;
          };
          reader.readAsDataURL(blob);
          await new Promise(resolve => setTimeout(resolve, 500));
          setCheatsheetLoading(false);
          return;
        } catch {}
      }

      // Desktop download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);
    } catch (err: any) {
      setCheatsheetError(err.message || 'PDF download failed');
    } finally {
      setCheatsheetLoading(false);
    }
  };

  const handleResetCheatsheet = () => {
    setCheatsheetFile(null);
    setCheatsheetLatex('');
    setCheatsheetComplete(false);
    setCheatsheetError('');
    setCheatsheetProgress(0);
    setCheatsheetTokenUsage(null);
    setActiveFeature(null);
    setStarted(false);
  };

  const handleDownloadPDF = async (includeSolutions: boolean = true) => {
    try {
      setError(''); // Clear any previous errors
      setLoading(true);
      const response = await fetch('/api/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          latex: latexContent, 
          includeSolutions,
          subject: config.subject,
          studentClass: config.studentClass
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'PDF generation failed');
      }

      const blob = await response.blob();
      // Format: studdybuddy_subjectname_class_date
      const dateStr = new Date().toISOString().split('T')[0];
      const sanitizedSubject = config.subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = config.studentClass.replace(/[^a-z0-9]+/g, '');
      const filename = `studdybuddy_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

      // Detect mobile/WebView environment
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      // For mobile/WebView: Use direct URL approach (most compatible)
      if (isMobile) {
        try {
          // Convert blob to ArrayBuffer then to base64
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );

          // Create a direct download link via server
          const linkResponse = await fetch('/api/get-pdf-link', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pdfBuffer: base64,
              filename: filename,
            }),
          });

          if (linkResponse.ok) {
            const { url } = await linkResponse.json();
            // Open the direct URL - this works in all WebView environments
            window.open(url, '_blank');
            setLoading(false);
            return;
          }
        } catch (linkErr) {
          console.log('Direct link method failed, trying fallback:', linkErr);
          // Continue to next method
        }

        // Fallback: data URL in new window
        try {
          const reader = new FileReader();
          reader.onloadend = function() {
            const base64data = reader.result as string;
            // Simple redirect to PDF
            const newWindow = window.open('', '_blank');
            if (newWindow) {
              newWindow.location.href = base64data;
            } else {
              // If popup blocked, try direct navigation
              window.location.href = base64data;
            }
          };
          reader.readAsDataURL(blob);
          
          await new Promise(resolve => setTimeout(resolve, 500));
          setLoading(false);
          return;
        } catch (err) {
          console.log('Data URL method failed:', err);
        }
      }

      // Desktop/final fallback: Traditional download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);

    } catch (err: any) {
      setError(err.message || 'PDF download failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-sky-50 to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-blue-600 via-sky-500 to-blue-500 text-white shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-4 md:py-6">
          <h1 className="text-2xl md:text-4xl font-bold mb-1 flex items-center gap-3">
            <span>📚</span> STUDYBUDDY
          </h1>
          <p className="text-xs md:text-sm opacity-90">AI-Powered Study Assistant</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* Get Started Screen */}
        {!started ? (
          <div className="space-y-6 animate-fadeIn">
            <div className="card p-8 md:p-12 text-center space-y-8">
              <div className="space-y-4">
                <h2 className="text-3xl md:text-5xl font-bold text-gray-800">Welcome</h2>
                <p className="text-base md:text-lg text-gray-600">Your AI-Powered Study Companion</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                <button
                  onClick={() => { setStarted(true); setActiveFeature('questions'); }}
                  className="bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold py-5 px-6 rounded-xl hover:shadow-lg transition-all transform hover:scale-105 text-base md:text-lg space-y-2"
                >
                  <div className="text-3xl">📝</div>
                  <div>Generate Questions</div>
                  <div className="text-xs font-normal opacity-80">Create question papers from textbooks</div>
                </button>
                <button
                  onClick={() => { setStarted(true); setActiveFeature('cheatsheet'); }}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 text-white font-bold py-5 px-6 rounded-xl hover:shadow-lg transition-all transform hover:scale-105 text-base md:text-lg space-y-2"
                >
                  <div className="text-3xl">📋</div>
                  <div>Cheatsheet</div>
                  <div className="text-xs font-normal opacity-80">Quick revision notes & formulas</div>
                </button>
              </div>
            </div>
            
            {/* Feature Highlights Banner */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-6 md:p-8 shadow-lg">
              <h3 className="text-xl md:text-2xl font-bold text-green-800 mb-6 text-center">✨ Study Buddy Features</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white/60 backdrop-blur rounded-lg p-5 border border-green-200">
                  <div className="text-3xl mb-2">📚</div>
                  <h4 className="font-bold text-gray-800 mb-2">All Chapters</h4>
                  <p className="text-sm text-gray-700">Questions generated from <strong>ALL chapters</strong> equally - no chapter left behind!</p>
                </div>
                <div className="bg-white/60 backdrop-blur rounded-lg p-5 border border-green-200">
                  <div className="text-3xl mb-2">🎯</div>
                  <h4 className="font-bold text-gray-800 mb-2">Exam-Standard</h4>
                  <p className="text-sm text-gray-700">Challenging questions based on actual <strong>board &amp; competitive exams</strong> - not easy questions!</p>
                </div>
                <div className="bg-white/60 backdrop-blur rounded-lg p-5 border border-green-200">
                  <div className="text-3xl mb-2">✅</div>
                  <h4 className="font-bold text-gray-800 mb-2">Full Solutions</h4>
                  <p className="text-sm text-gray-700"><strong>Complete step-by-step solutions</strong> with detailed explanations included</p>
                </div>
                <div className="bg-white/60 backdrop-blur rounded-lg p-5 border border-orange-200">
                  <div className="text-3xl mb-2">📋</div>
                  <h4 className="font-bold text-gray-800 mb-2">Cheatsheet</h4>
                  <p className="text-sm text-gray-700"><strong>Quick revision notes</strong>, formulas & key definitions grouped by chapter</p>
                </div>
              </div>
            </div>
          </div>
        ) : activeFeature === 'cheatsheet' ? (
          /* ===== CHEATSHEET FEATURE ===== */
          <div className="space-y-6 animate-fadeIn">
            {!cheatsheetComplete ? (
              <>
                {/* Cheatsheet Config Card */}
                <div className="card p-6 md:p-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-3">
                      <span>📋</span> Cheatsheet Generator
                    </h2>
                    <span className="bg-orange-100 text-orange-700 text-xs font-bold px-3 py-1 rounded-full">NEW</span>
                  </div>
                  <p className="text-sm text-gray-600">Upload your textbook PDF and get a <strong>comprehensive one-shot revision cheatsheet</strong> — every important topic, formula, equation, definition, and key fact organized chapter-wise. Designed so you can revise the entire syllabus in one read!</p>

                  {/* Class & Subject Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">📚 Class</label>
                      <select
                        value={cheatsheetClass}
                        onChange={(e) => setCheatsheetClass(e.target.value)}
                        className="input-field appearance-none cursor-pointer"
                      >
                        {CHEATSHEET_CLASSES.map(cls => (
                          <option key={cls.value} value={cls.value}>{cls.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">📐 Subject</label>
                      <select
                        value={cheatsheetSubject}
                        onChange={(e) => setCheatsheetSubject(e.target.value)}
                        className="input-field appearance-none cursor-pointer"
                      >
                        {CHEATSHEET_SUBJECTS.map(sub => (
                          <option key={sub.value} value={sub.value}>{sub.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* PDF Upload */}
                  <div className="space-y-3">
                    <h3 className="text-base md:text-lg font-bold text-gray-800">📄 Upload Textbook PDF</h3>
                    <div
                      className={`border-3 border-dashed rounded-xl p-8 md:p-12 text-center cursor-pointer transition-all ${
                        isDraggingCheatsheet
                          ? 'border-orange-500 bg-orange-100 scale-105'
                          : 'border-orange-300 bg-orange-50 hover:bg-orange-100'
                      }`}
                      onDragOver={handleCheatsheetDragOver}
                      onDragLeave={handleCheatsheetDragLeave}
                      onDrop={handleCheatsheetDrop}
                      onClick={() => cheatsheetFileInputRef.current?.click()}
                    >
                      <div className="text-5xl md:text-6xl mb-4">📄</div>
                      <p className="text-base md:text-lg text-gray-700 font-semibold mb-2">
                        {cheatsheetFile ? <span className="text-orange-600">{cheatsheetFile.name}</span> : 'Drag PDF or click to Upload'}
                      </p>
                      <p className="text-xs md:text-sm text-red-600 font-semibold">Max 7 MB</p>
                      <input
                        ref={cheatsheetFileInputRef}
                        type="file"
                        accept="application/pdf"
                        onChange={handleCheatsheetFileChange}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* What You'll Get */}
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-bold text-amber-800">📌 What Your Cheatsheet Will Include:</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-amber-900">
                      <div className="flex gap-2"><span>✓</span> <span><strong>Every important topic</strong> explained clearly per chapter</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>All definitions & terms</strong> from the textbook</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>Complete formula/equation bank</strong> (for STEM)</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>Year-wise event timelines</strong> (for History)</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>All chemical equations</strong> grouped by type (Chemistry)</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>Comparison tables</strong> & classification charts</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>Key points marked (IMP)</strong> for exam focus</span></div>
                      <div className="flex gap-2"><span>✓</span> <span><strong>Quick revision bullets</strong> for last-minute study</span></div>
                      <div className="flex gap-2 md:col-span-2"><span>⭐</span> <span><strong>5 Marks Important Notes</strong> — exam-ready short answers you can memorize & write directly</span></div>
                    </div>
                  </div>

                  {/* Generate Button */}
                  <button
                    type="button"
                    onClick={handleGenerateCheatsheet}
                    disabled={!cheatsheetFile || cheatsheetLoading}
                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold py-4 md:py-5 rounded-xl text-base md:text-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50"
                  >
                    {cheatsheetLoading ? (
                      <>
                        <span className="inline-block w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                        Generating Cheatsheet...
                      </>
                    ) : (
                      <>
                        <span>📋</span> Generate Cheatsheet
                      </>
                    )}
                  </button>

                  {/* Back Button */}
                  <button
                    onClick={handleResetCheatsheet}
                    className="text-gray-500 hover:text-gray-700 text-sm font-semibold text-center w-full mt-2"
                  >
                    ← Back to Start
                  </button>
                </div>

                {/* Error */}
                {cheatsheetError && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 md:p-6 shadow-md animate-fadeIn flex items-start gap-4">
                    <span className="text-3xl">⚠️</span>
                    <div className="flex-1">
                      <p className="text-red-700 text-sm md:text-base">{cheatsheetError}</p>
                    </div>
                  </div>
                )}

                {/* Loading Indicator */}
                {cheatsheetLoading && (
                  <div className="card p-12 text-center space-y-8 bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 border-2 border-orange-300 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 via-amber-400 to-yellow-400 animate-pulse"></div>
                    <div className="space-y-6 relative z-10">
                      <div className="inline-block">
                        <div className="relative w-24 h-24 mx-auto">
                          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-orange-600 border-r-amber-600 animate-spin" style={{ animationDuration: '2s' }}></div>
                          <div className="absolute inset-2 rounded-full border-4 border-transparent border-b-yellow-500 border-l-orange-500 animate-spin" style={{ animationDuration: '3s', animationDirection: 'reverse' }}></div>
                          <svg className="absolute inset-0 w-24 h-24" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="45" fill="none" stroke="#fed7aa" strokeWidth="3" />
                            <circle cx="50" cy="50" r="45" fill="none" stroke="url(#cheatsheetGradient)" strokeWidth="3"
                              strokeDasharray={`${2 * Math.PI * 45}`}
                              strokeDashoffset={`${2 * Math.PI * 45 * (1 - cheatsheetProgress / 100)}`}
                              strokeLinecap="round"
                              style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                            />
                            <defs>
                              <linearGradient id="cheatsheetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#ea580c" />
                                <stop offset="50%" stopColor="#d97706" />
                                <stop offset="100%" stopColor="#ca8a04" />
                              </linearGradient>
                            </defs>
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xl font-bold bg-gradient-to-r from-orange-600 via-amber-600 to-yellow-600 bg-clip-text text-transparent">{Math.round(cheatsheetProgress)}%</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-lg font-bold bg-gradient-to-r from-orange-600 via-amber-600 to-yellow-600 bg-clip-text text-transparent">Creating your cheatsheet...</p>
                        <div className="min-h-16 flex items-center justify-center">
                          <p className="text-orange-600 font-semibold italic text-base animate-pulse max-w-md">{currentQuote}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Cheatsheet Results */
              <>
                <div className="card p-6 md:p-8 bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-400 space-y-6">
                  <div className="text-center space-y-4">
                    <div className="text-6xl animate-bounce">📋</div>
                    <h2 className="text-3xl md:text-4xl font-bold text-orange-700">Cheatsheet Ready!</h2>
                    <p className="text-lg text-gray-700">Your comprehensive revision notes have been generated.</p>
                  </div>

                  {/* Token Usage */}
                  {cheatsheetTokenUsage && (
                    <div className="bg-white/60 rounded-xl p-4 border border-orange-200 max-w-xl mx-auto">
                      <h3 className="text-sm font-bold text-gray-700 mb-3 text-center">📊 AI Token Usage</h3>
                      <div className="grid grid-cols-3 gap-3 text-center text-xs">
                        <div className="bg-orange-50 rounded-lg p-2 border border-orange-200">
                          <p className="font-bold text-orange-700 text-lg">{cheatsheetTokenUsage.promptTokens.toLocaleString()}</p>
                          <p className="text-gray-600">Input</p>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
                          <p className="font-bold text-amber-700 text-lg">{cheatsheetTokenUsage.outputTokens.toLocaleString()}</p>
                          <p className="text-gray-600">Output</p>
                        </div>
                        <div className="bg-yellow-50 rounded-lg p-2 border border-yellow-200">
                          <p className="font-bold text-yellow-700 text-lg">{cheatsheetTokenUsage.totalTokens.toLocaleString()}</p>
                          <p className="text-gray-600">Total</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Preview & Download */}
                <div className="card p-6 md:p-8 space-y-6">
                  <h2 className="text-2xl md:text-3xl font-bold text-gray-800">✅ Preview</h2>
                  
                  {/* LaTeX Preview */}
                  <div className="border-2 border-orange-200 rounded-xl p-4 md:p-6 bg-white max-h-96 overflow-y-auto">
                    <LatexPreview content={cheatsheetLatex} />
                  </div>

                  {/* Download Button */}
                  <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-6 rounded-xl border-2 border-orange-200 space-y-4">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">📥 Download Cheatsheet</h3>
                    <button
                      onClick={handleDownloadCheatsheetPDF}
                      disabled={cheatsheetLoading}
                      className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold py-3 px-6 rounded-xl text-base flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                    >
                      {cheatsheetLoading ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          Preparing PDF...
                        </>
                      ) : (
                        <>
                          <span>📄</span> Download as PDF
                        </>
                      )}
                    </button>
                  </div>

                  {/* Generate Another */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                    <button
                      onClick={handleResetCheatsheet}
                      className="bg-gradient-to-r from-orange-600 to-amber-600 text-white font-bold py-3 px-8 rounded-xl hover:shadow-lg transition-all text-lg"
                    >
                      🔄 Generate Another Cheatsheet
                    </button>
                    <button
                      onClick={() => { setShowFeedbackForm(true); setFeedbackSuccess(false); setFeedbackError(''); }}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold py-3 px-8 rounded-xl hover:shadow-lg transition-all text-lg"
                    >
                      💬 Share Your Feedback
                    </button>
                  </div>
                </div>

                {/* Error */}
                {cheatsheetError && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 md:p-6 shadow-md animate-fadeIn flex items-start gap-4">
                    <span className="text-3xl">⚠️</span>
                    <div className="flex-1">
                      <p className="text-red-700 text-sm md:text-base">{cheatsheetError}</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* Question Customizer - Shown for question generation flow */}
            <QuestionCustomizer 
              config={config} 
              onConfigChange={setConfig} 
              mode={mode}
              onModeChange={setMode}
            />

            {/* Upload Section - Only show when mode is selected */}
            {mode && (
              <div className="card p-6 md:p-8 space-y-6">
                <h2 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-3">
                  <span>📤</span> Upload
                </h2>

              {/* Pattern File Upload - Only for Pattern Mode */}
              {mode === 'pattern' && (
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-4 md:p-6 rounded-xl border-2 border-purple-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base md:text-lg font-bold text-gray-800">📋 Sample Paper</h3>
                    {patternFile && (
                      <button
                        onClick={() => setPatternFile(null)}
                        className="text-red-600 hover:text-red-700 font-semibold"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div
                    className="border-2 border-dashed border-purple-400 rounded-lg p-6 text-center cursor-pointer hover:bg-purple-100 transition-colors bg-white"
                    onClick={() => patternFileInputRef.current?.click()}
                  >
                    <div className="text-3xl md:text-4xl mb-2">📋</div>
                    {patternFile ? (
                      <div>
                        <p className="font-semibold text-purple-600">{patternFile.name}</p>
                        <p className="text-xs text-green-600 mt-1">✓ Loaded</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm md:text-base text-gray-600">Click to upload sample paper</p>
                        <p className="text-xs text-red-600 font-semibold mt-1">Max: 1MB</p>
                      </>
                    )}
                    <input
                      ref={patternFileInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={handlePatternFileChange}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* Main PDF Upload */}
              <div className="space-y-3">
                <h3 className="text-base md:text-lg font-bold text-gray-800">📚 Textbook PDF</h3>
                <div
                  className={`border-3 border-dashed rounded-xl p-8 md:p-12 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-blue-600 bg-blue-100 scale-105'
                      : 'border-blue-300 bg-blue-50 hover:bg-blue-100'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="text-5xl md:text-6xl mb-4">📄</div>
                  <p className="text-base md:text-lg text-gray-700 font-semibold mb-2">
                    {file ? <span className="text-blue-600">{file.name}</span> : 'Drag PDF or click to Upload'}
                  </p>
                  <p className="text-xs md:text-sm text-red-600 font-semibold">Max 7 MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Generate Button */}
              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || loading}
                className="w-full btn-primary py-4 md:py-5 text-base md:text-lg font-bold flex items-center justify-center gap-3"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                    Generating...
                  </>
                ) : (
                  <>
                    <span>✨</span> Generate Questions
                  </>
                )}
              </button>

              {/* Back to Start */}
              <button
                onClick={() => {
                  setMode(null);
                  setFile(null);
                  setPatternFile(null);
                  setLatexContent('');
                  setError('');
                  setStarted(false);
                  setActiveFeature(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-sm font-semibold text-center w-full mt-2"
              >
                ← Back to Start
              </button>
            </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 md:p-6 shadow-md animate-fadeIn flex items-start gap-4">
                <span className="text-3xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-red-700 text-sm md:text-base">{error}</p>
                </div>
              </div>
            )}

            {/* Results Section */}
            {latexContent && (
              <div className="animate-fadeIn">
                {generationComplete && (
                  <div className="card p-6 md:p-8 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-400 space-y-6">
                    <div className="text-center space-y-4">
                      <div className="text-6xl animate-bounce">🎉</div>
                      <h2 className="text-3xl md:text-4xl font-bold text-green-700">Thank You!</h2>
                      <p className="text-lg text-gray-700">Your question paper has been generated successfully!</p>
                      <p className="text-purple-600 font-semibold italic text-lg">{EXAM_QUOTES[Math.floor(Math.random() * EXAM_QUOTES.length)]}</p>
                    </div>

                    {/* Token Usage Stats */}
                    {tokenUsage && (
                      <div className="bg-white/60 rounded-xl p-4 border border-green-200 max-w-xl mx-auto">
                        <h3 className="text-sm font-bold text-gray-700 mb-3 text-center">📊 AI Token Usage</h3>
                        <div className="grid grid-cols-3 gap-3 text-center text-xs">
                          <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                            <p className="font-bold text-blue-700 text-lg">{tokenUsage.total.promptTokens.toLocaleString()}</p>
                            <p className="text-gray-600">Input Tokens</p>
                          </div>
                          <div className="bg-purple-50 rounded-lg p-2 border border-purple-200">
                            <p className="font-bold text-purple-700 text-lg">{tokenUsage.total.outputTokens.toLocaleString()}</p>
                            <p className="text-gray-600">Output Tokens</p>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                            <p className="font-bold text-green-700 text-lg">{tokenUsage.total.totalTokens.toLocaleString()}</p>
                            <p className="text-gray-600">Total Tokens</p>
                          </div>
                        </div>
                        <details className="mt-3">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 text-center">View breakdown</summary>
                          <div className="mt-2 space-y-1 text-xs text-gray-600">
                            <div className="flex justify-between bg-gray-50 px-3 py-1 rounded">
                              <span>📄 PDF Extraction</span>
                              <span className="font-mono">{tokenUsage.extraction.totalTokens.toLocaleString()} tokens</span>
                            </div>
                            {tokenUsage.pattern.totalTokens > 0 && (
                              <div className="flex justify-between bg-gray-50 px-3 py-1 rounded">
                                <span>📋 Pattern Analysis</span>
                                <span className="font-mono">{tokenUsage.pattern.totalTokens.toLocaleString()} tokens</span>
                              </div>
                            )}
                            <div className="flex justify-between bg-gray-50 px-3 py-1 rounded">
                              <span>✨ Question Generation</span>
                              <span className="font-mono">{tokenUsage.generation.totalTokens.toLocaleString()} tokens</span>
                            </div>
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                )}

                <div className="card p-6 md:p-8 space-y-6 mt-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-800">✅ Generated</h2>
                    {allQuestions.length > 0 && (
                      <button
                        onClick={() => setShowCompleteSolutions(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-xs sm:text-sm w-full sm:w-auto whitespace-nowrap"
                      >
                        📋 See Complete Solution
                      </button>
                    )}
                  </div>

                  <div className={isFromPattern ? 'hidden' : ''}>
                    <LatexPreview content={latexContent} onQuestionsLoaded={setAllQuestions} />
                  </div>
                  
                  {isFromPattern && (
                    <div className="text-center space-y-3 py-8">
                      <div className="text-5xl">✓</div>
                      <p className="text-lg font-bold text-gray-800">Generated Successfully</p>
                      <p className="text-sm text-gray-600">Download using options below</p>
                    </div>
                  )}

                  {/* Download Buttons - Positioned Below */}
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-xl border-2 border-blue-200 space-y-4">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">📥 Download Options</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button
                        onClick={() => handleDownloadPDF(false)}
                        disabled={loading}
                        className="btn-secondary py-3 px-6 text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <span>📄</span> Download Questions
                      </button>
                      <button
                        onClick={() => handleDownloadPDF(true)}
                        disabled={loading}
                        className="btn-primary py-3 px-6 text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <span>📚</span> Download With Solutions
                      </button>
                    </div>
                  </div>

                  {/* Generate Another Button */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 pt-6">
                    <button
                      onClick={handleResetAndGenerateAnother}
                      className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold py-3 px-8 rounded-xl hover:shadow-lg transition-all text-lg"
                    >
                      🔄 Generate Another Question Paper
                    </button>
                    
                    {/* Feedback Button */}
                    <button
                      onClick={() => { setShowFeedbackForm(true); setFeedbackSuccess(false); setFeedbackError(''); }}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold py-3 px-8 rounded-xl hover:shadow-lg transition-all text-lg"
                    >
                      💬 Share Your Feedback
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Complete Solutions Modal */}
            {showCompleteSolutions && (
              <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl max-w-4xl max-h-[90vh] w-full overflow-y-auto relative">
                  {/* Close Button */}
                  <button
                    onClick={() => setShowCompleteSolutions(false)}
                    className="absolute top-4 right-4 bg-red-600 hover:bg-red-700 text-white rounded-full w-10 h-10 flex items-center justify-center z-10 font-bold text-xl"
                  >
                    ✕
                  </button>

                  <div ref={modalPreviewRef} className="p-6 md:p-8 space-y-6">
                    <div className="text-center mb-6 mt-6">
                      <h2 className="text-2xl md:text-3xl font-bold text-purple-700">📚 Complete Solutions</h2>
                      <p className="text-gray-600 mt-2">{allQuestions.length} Questions with Solutions</p>
                    </div>

                    <div className="space-y-6">
                      {allQuestions.map((q) => (
                        <div key={q.number} className="border-2 border-purple-200 rounded-lg overflow-hidden">
                          {/* Question Header */}
                          <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-4">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2">
                              <span className="bg-white text-purple-600 w-8 h-8 rounded-full flex items-center justify-center font-bold">
                                {q.number}
                              </span>
                              Question {q.number}
                            </h3>
                          </div>

                          {/* Question Content */}
                          <div className="p-4 bg-white border-b border-gray-200">
                            <div
                              className="prose prose-sm max-w-none text-gray-800 text-sm leading-relaxed [&>p]:my-2 [&>ul]:my-2 [&>ol]:my-2 [&_li]:my-0.5"
                              dangerouslySetInnerHTML={{ __html: formatContent(q.question) }}
                            />
                          </div>

                          {/* Solution */}
                          {q.solution && (
                            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-4 border-t-2 border-green-300">
                              <p className="font-bold text-green-700 mb-2">✓ Solution:</p>
                              <div
                                className="prose prose-sm max-w-none text-gray-800 text-sm leading-relaxed [&>p]:my-2 [&>ul]:my-2 [&>ol]:my-2 [&_li]:my-0.5"
                                dangerouslySetInnerHTML={{ __html: formatContent(q.solution) }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading Indicator with Progress Bar */}
            {loading && !latexContent && (
              <div className="card p-12 text-center space-y-8 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 border-2 border-blue-300 relative overflow-hidden">
                {/* Animated background elements */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 animate-pulse"></div>
                
                <div className="space-y-6 relative z-10">
                  <div className="inline-block">
                    <div className="relative w-24 h-24 mx-auto">
                      {/* Outer rotating ring */}
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-600 border-r-purple-600 animate-spin" style={{ animationDuration: '2s' }}></div>
                      
                      {/* Middle rotating ring */}
                      <div className="absolute inset-2 rounded-full border-4 border-transparent border-b-pink-500 border-l-blue-500 animate-spin" style={{ animationDuration: '3s', animationDirection: 'reverse' }}></div>
                      
                      {/* SVG Progress circle */}
                      <svg className="absolute inset-0 w-24 h-24" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="#e0e7ff" strokeWidth="3" />
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          fill="none"
                          stroke="url(#progressGradient)"
                          strokeWidth="3"
                          strokeDasharray={`${2 * Math.PI * 45}`}
                          strokeDashoffset={`${2 * Math.PI * 45 * (1 - loadingProgress / 100)}`}
                          strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                        />
                        <defs>
                          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="50%" stopColor="#8b5cf6" />
                            <stop offset="100%" stopColor="#ec4899" />
                          </linearGradient>
                        </defs>
                      </svg>
                      
                      {/* Center percentage */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <span className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">{Math.round(loadingProgress)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-lg font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">Generating your questions...</p>
                    <div className="min-h-16 flex items-center justify-center">
                      <p className="text-purple-600 font-semibold italic text-base animate-pulse max-w-md">{currentQuote}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Feedback Popup */}
      {showFeedbackForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={() => setShowFeedbackForm(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-fadeIn" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">💬 Share Your Feedback</h2>
              <button
                onClick={() => setShowFeedbackForm(false)}
                className="text-white hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center font-bold text-lg transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {feedbackSuccess ? (
                <div className="text-center py-8 space-y-3">
                  <div className="text-5xl">🎉</div>
                  <p className="text-xl font-bold text-green-600">Thank you!</p>
                  <p className="text-gray-600">Your feedback has been submitted.</p>
                </div>
              ) : (
                <>
                  {/* Name */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      placeholder="Enter your name"
                      value={feedbackForm.name}
                      onChange={(e) => setFeedbackForm({ ...feedbackForm, name: e.target.value })}
                      className="input-field"
                    />
                  </div>

                  {/* Class */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Class <span className="text-red-500">*</span></label>
                    <select
                      value={feedbackForm.studentClass}
                      onChange={(e) => setFeedbackForm({ ...feedbackForm, studentClass: e.target.value })}
                      className="input-field appearance-none cursor-pointer"
                    >
                      <option value="">Select your class</option>
                      {FEEDBACK_CLASSES.map(cls => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Subject <span className="text-red-500">*</span></label>
                    <select
                      value={feedbackForm.subject}
                      onChange={(e) => setFeedbackForm({ ...feedbackForm, subject: e.target.value })}
                      className="input-field appearance-none cursor-pointer"
                    >
                      <option value="">Select your subject</option>
                      {FEEDBACK_SUBJECTS.map(sub => (
                        <option key={sub} value={sub}>{sub}</option>
                      ))}
                    </select>
                  </div>

                  {/* Suggestions */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Suggestions</label>
                    <textarea
                      placeholder="Any feedback or suggestions for us..."
                      rows={3}
                      value={feedbackForm.suggestions}
                      onChange={(e) => setFeedbackForm({ ...feedbackForm, suggestions: e.target.value })}
                      className="input-field resize-none"
                    />
                  </div>

                  {/* Error */}
                  {feedbackError && (
                    <p className="text-red-600 text-sm font-medium">⚠️ {feedbackError}</p>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleFeedbackSubmit}
                    disabled={feedbackLoading}
                    className="w-full btn-primary py-3 text-base font-bold flex items-center justify-center gap-2"
                  >
                    {feedbackLoading ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        Submitting...
                      </>
                    ) : (
                      'Submit Feedback'
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-blue-100 bg-white/50 mt-12 py-6 text-center text-sm text-gray-600">
        <p>© 2026 STUDYBUDDY</p>
      </footer>
    </div>
  );
}

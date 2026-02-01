'use client';

import { useState, useEffect, useRef } from 'react';
import { useSwipe } from '@/hooks/useSwipe';

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

interface Props {
  config: QuestionConfig;
  onConfigChange: (config: QuestionConfig) => void;
  mode: 'pattern' | 'custom';
}

const SUBJECTS = [
  { value: 'mathematics', label: '📐 Mathematics', levels: ['secondary', 'higher-secondary', 'college'] },
  { value: 'general-science', label: '🔬 General Science', levels: ['secondary'] },
  { value: 'english', label: '📚 English', levels: ['secondary', 'higher-secondary', 'college'] },
  { value: 'hindi', label: '🇮🇳 Hindi', levels: ['secondary', 'higher-secondary'] },
  { value: 'social-science', label: '🌍 Social Science', levels: ['secondary'] },
  { value: 'computer-science', label: '💻 Computer Science', levels: ['secondary', 'higher-secondary', 'college'] },
  { value: 'sanskrit', label: '🕉️ Sanskrit', levels: ['secondary', 'higher-secondary'] },
  { value: 'environmental-science', label: '🌱 Environmental Science', levels: ['secondary', 'college'] },
  { value: 'physics', label: '⚛️ Physics', levels: ['higher-secondary', 'college'] },
  { value: 'chemistry', label: '🧪 Chemistry', levels: ['higher-secondary', 'college'] },
  { value: 'biology', label: '🧬 Biology', levels: ['higher-secondary', 'college'] },
  { value: 'history', label: '📜 History', levels: ['higher-secondary', 'college'] },
  { value: 'geography', label: '🗺️ Geography', levels: ['higher-secondary', 'college'] },
  { value: 'political-science', label: '🏛️ Political Science', levels: ['higher-secondary', 'college'] },
  { value: 'economics', label: '💰 Economics', levels: ['higher-secondary', 'college'] },
  { value: 'accountancy', label: '📊 Accountancy', levels: ['higher-secondary', 'college'] },
  { value: 'business-studies', label: '💼 Business Studies', levels: ['higher-secondary', 'college'] },
  { value: 'psychology', label: '🧠 Psychology', levels: ['higher-secondary', 'college'] },
  { value: 'sociology', label: '👥 Sociology', levels: ['higher-secondary', 'college'] },
  { value: 'physical-education', label: '⚽ Physical Education', levels: ['higher-secondary'] },
  { value: 'statistics', label: '📈 Statistics', levels: ['college'] },
  { value: 'engineering', label: '⚙️ Engineering', levels: ['college'] },
  { value: 'philosophy', label: '💭 Philosophy', levels: ['college'] },
  { value: 'law', label: '⚖️ Law', levels: ['college'] },
  { value: 'medical-science', label: '🏥 Medical Science', levels: ['college'] },
  { value: 'commerce', label: '💳 Commerce', levels: ['college'] },
];

const DIFFICULTIES = [
  { value: 'easy', label: '🟢 easy' },
  { value: 'medium', label: '🟡 moderate' },
  { value: 'hard', label: '🔴 difficult' },
  //{ value: 'mixed', label: '🎯 mixed' },
];

const CLASS_CATEGORIES = [
  {
    value: 'secondary',
    label: '📚 Secondary',
    classes: [
      { value: '4', label: 'Class 4' },
      { value: '5', label: 'Class 5' },
      { value: '6', label: 'Class 6' },
      { value: '7', label: 'Class 7' },
      { value: '8', label: 'Class 8' },
      { value: '9', label: 'Class 9' },
      { value: '10', label: 'Class 10' },
    ]
  },
  {
    value: 'higher-secondary',
    label: '🎓 Higher Secondary',
    classes: [
      { value: '11', label: 'Class 11' },
      { value: '12', label: 'Class 12' },
    ]
  },
  {
    value: 'college',
    label: '🏛️ College/University',
    classes: []
  }
];

type Step = 'class' | 'subject' | 'difficulty' | 'customize' | 'complete';

export default function QuestionCustomizer({ config, onConfigChange, mode }: Props) {
  const [step, setStep] = useState<Step>('class');
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setHoveredCategory(null);
      }
    };

    if (hoveredCategory) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [hoveredCategory]);

  const swipeHandlers = useSwipe({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    threshold: 30,
  });

  function handleSwipeLeft() {
    if (step === 'class') goToStep('subject');
    else if (step === 'subject') goToStep('difficulty');
    else if (step === 'difficulty') goToStep(mode === 'pattern' ? 'complete' : 'customize');
    else if (step === 'customize') goToStep('complete');
  }

  function handleSwipeRight() {
    if (step === 'subject') goToStep('class');
    else if (step === 'difficulty') goToStep('subject');
    else if (step === 'customize') goToStep('difficulty');
    else if (step === 'complete') goToStep(mode === 'pattern' ? 'difficulty' : 'customize');
  }

  function goToStep(newStep: Step) {
    setStep(newStep);
  }

  const getStepNumber = () => {
    const steps = mode === 'pattern' 
      ? ['class', 'subject', 'difficulty', 'complete'] 
      : ['class', 'subject', 'difficulty', 'customize', 'complete'];
    return steps.indexOf(step) + 1;
  };

  const getTotalSteps = () => mode === 'pattern' ? 4 : 5;

  // Get current class level category
  const getCurrentClassLevel = (): string => {
    if (config.studentClass === 'college') return 'college';
    if (['11', '12'].includes(config.studentClass)) return 'higher-secondary';
    if (['4', '5', '6', '7', '8', '9', '10'].includes(config.studentClass)) return 'secondary';
    return 'secondary'; // default
  };

  // Filter subjects based on selected class level
  const getAvailableSubjects = () => {
    const level = getCurrentClassLevel();
    return SUBJECTS.filter(subject => subject.levels.includes(level));
  };

  const renderClassSelector = () => {
    return (
      <div className="animate-fadeIn" ref={dropdownRef}>
        <h3 className="text-lg font-bold text-gray-800 mb-4">Select Class Level</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {CLASS_CATEGORIES.map(category => (
            <div
              key={category.value}
              className="relative"
              onMouseEnter={() => category.classes.length > 0 && setHoveredCategory(category.value)}
              onMouseLeave={() => setHoveredCategory(null)}
            >
              <button
                onClick={() => {
                  if (category.value === 'college') {
                    onConfigChange({ ...config, studentClass: 'college' });
                    goToStep('subject');
                  } else {
                    // Toggle dropdown on click for mobile
                    setHoveredCategory(hoveredCategory === category.value ? null : category.value);
                  }
                }}
                className={`w-full py-4 px-3 rounded-lg font-semibold text-sm transition-all ${
                  config.studentClass === category.value || 
                  (category.value === 'secondary' && ['4', '5', '6', '7', '8', '9', '10'].includes(config.studentClass)) ||
                  (category.value === 'higher-secondary' && ['11', '12'].includes(config.studentClass))
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-sky-100 text-blue-700 hover:bg-sky-200'
                }`}
              >
                {category.label}
                {category.classes.length > 0 && (
                  <span className="text-xs block mt-1 opacity-75">
                    {hoveredCategory === category.value ? '▲ Select class' : '▼ Click/Hover to select'}
                  </span>
                )}
              </button>

              {/* Dropdown for classes */}
              {category.classes.length > 0 && hoveredCategory === category.value && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border-2 border-blue-300 rounded-lg shadow-xl z-50 overflow-hidden">
                  {category.classes.map(cls => (
                    <button
                      key={cls.value}
                      onClick={() => {
                        onConfigChange({ ...config, studentClass: cls.value });
                        goToStep('subject');
                        setHoveredCategory(null);
                      }}
                      className={`w-full py-2 px-3 text-left text-sm font-medium transition-all ${
                        config.studentClass === cls.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-blue-700 hover:bg-blue-50'
                      }`}
                    >
                      {cls.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSubjectSelector = () => {
    const availableSubjects = getAvailableSubjects();
    
    return (
      <div className="animate-fadeIn">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Select Subject</h3>
        <p className="text-xs text-gray-500 mb-3">
          Showing subjects for {getCurrentClassLevel() === 'secondary' ? 'Secondary' : getCurrentClassLevel() === 'higher-secondary' ? 'Higher Secondary' : 'College/University'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
          {availableSubjects.map(subject => (
            <button
              key={subject.value}
              onClick={() => {
                onConfigChange({ ...config, subject: subject.value });
                goToStep('difficulty');
              }}
              className={`py-3 px-3 rounded-lg font-semibold text-sm transition-all text-left ${
                config.subject === subject.value
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-sky-100 text-blue-700 hover:bg-sky-200'
              }`}
            >
              {subject.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderDifficultySelector = () => (
    <div className="animate-fadeIn">
      <h3 className="text-lg font-bold text-gray-800 mb-4">Select Difficulty</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {DIFFICULTIES.map(diff => (
          <button
            key={diff.value}
            onClick={() => {
              onConfigChange({ ...config, difficulty: diff.value });
              goToStep(mode === 'pattern' ? 'complete' : 'customize');
            }}
            className={`py-3 px-2 rounded-lg font-semibold text-xs md:text-sm transition-all ${
              config.difficulty === diff.value
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-sky-100 text-blue-700 hover:bg-sky-200'
            }`}
          >
            {diff.label}
          </button>
        ))}
      </div>
    </div>
  );

  const [errorMessages, setErrorMessages] = useState<{ [key: string]: string }>({});
  const MAX_QUESTIONS_BY_TYPE = 20;
  const MAX_QUESTIONS_BY_MARKS = 20;

  const handleQuestionTypeCountChange = (type: keyof NonNullable<QuestionConfig['questionsByType']>, delta: number) => {
    const current = config.questionsByType || { mcq: 0, fillInBlanks: 0, trueFalse: 0, general: 0 };
    let newValue = Math.max(0, (current[type] || 0) + delta);
    
    const newErrors = { ...errorMessages };
    if (newValue > MAX_QUESTIONS_BY_TYPE) {
      newValue = MAX_QUESTIONS_BY_TYPE;
      newErrors[type] = `Max ${MAX_QUESTIONS_BY_TYPE} questions allowed`;
    } else {
      delete newErrors[type];
    }
    setErrorMessages(newErrors);
    
    onConfigChange({
      ...config,
      questionsByType: { ...current, [type]: newValue }
    });
  };

  const handleQuestionTypeInputChange = (type: keyof NonNullable<QuestionConfig['questionsByType']>, value: string) => {
    const numValue = parseInt(value) || 0;
    let finalValue = Math.max(0, numValue);
    
    const newErrors = { ...errorMessages };
    if (finalValue > MAX_QUESTIONS_BY_TYPE) {
      finalValue = MAX_QUESTIONS_BY_TYPE;
      newErrors[type] = `Max ${MAX_QUESTIONS_BY_TYPE} questions allowed`;
    } else {
      delete newErrors[type];
    }
    setErrorMessages(newErrors);
    
    onConfigChange({
      ...config,
      questionsByType: { ...config.questionsByType || { mcq: 0, fillInBlanks: 0, trueFalse: 0, general: 0 }, [type]: finalValue }
    });
  };

  const handleQuestionMarkCountChange = (marks: keyof NonNullable<QuestionConfig['questionsByMarks']>, delta: number) => {
    const current = config.questionsByMarks || { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '10': 0 };
    let newValue = Math.max(0, (current[marks] || 0) + delta);
    
    const newErrors = { ...errorMessages };
    if (newValue > MAX_QUESTIONS_BY_MARKS) {
      newValue = MAX_QUESTIONS_BY_MARKS;
      newErrors[`marks_${marks}`] = `Max ${MAX_QUESTIONS_BY_MARKS} questions allowed`;
    } else {
      delete newErrors[`marks_${marks}`];
    }
    setErrorMessages(newErrors);
    
    onConfigChange({
      ...config,
      questionsByMarks: { ...current, [marks]: newValue }
    });
  };

  const handleQuestionMarkInputChange = (marks: keyof NonNullable<QuestionConfig['questionsByMarks']>, value: string) => {
    const numValue = parseInt(value) || 0;
    let finalValue = Math.max(0, numValue);
    
    const newErrors = { ...errorMessages };
    if (finalValue > MAX_QUESTIONS_BY_MARKS) {
      finalValue = MAX_QUESTIONS_BY_MARKS;
      newErrors[`marks_${marks}`] = `Max ${MAX_QUESTIONS_BY_MARKS} questions allowed`;
    } else {
      delete newErrors[`marks_${marks}`];
    }
    setErrorMessages(newErrors);
    
    onConfigChange({
      ...config,
      questionsByMarks: { ...config.questionsByMarks || { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '10': 0 }, [marks]: finalValue }
    });
  };

  const getTotalQuestionsByType = () => {
    const types = config.questionsByType || { mcq: 0, fillInBlanks: 0, trueFalse: 0, general: 0 };
    return types.mcq + types.fillInBlanks + types.trueFalse + types.general;
  };

  const getTotalQuestionsByMarks = () => {
    const marks = config.questionsByMarks || { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '10': 0 };
    return marks['2'] + marks['3'] + marks['4'] + marks['5'] + marks['6'] + marks['10'];
  };

  const renderCustomizeOptions = () => (
    <div className="animate-fadeIn space-y-4">
      <h3 className="text-lg font-bold text-gray-800 mb-4">⚙️ Question Configuration</h3>
      
      {/* Question Types */}
      <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 space-y-3">
        <div className="flex justify-between items-center">
          <p className="font-bold text-gray-800 text-sm">One Mark Questions</p>
          <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Total: {getTotalQuestionsByType()}</span>
        </div>
        <div className="space-y-2">
          {[
            { key: 'mcq' as const, label: 'MCQ' },
            { key: 'trueFalse' as const, label: 'True/False' },
            { key: 'fillInBlanks' as const, label: 'Fill in the Blanks' },
            { key: 'general' as const, label: 'Short Answer Type' }
          ].map(item => (
            <div key={item.key}>
              <div className="flex items-center justify-between bg-white p-2 rounded border border-blue-100">
                <span className="font-medium text-gray-700 text-xs flex-1">{item.label}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleQuestionTypeCountChange(item.key, -1)}
                    className="w-6 h-6 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    max={MAX_QUESTIONS_BY_TYPE}
                    value={config.questionsByType?.[item.key] || 0}
                    onChange={(e) => handleQuestionTypeInputChange(item.key, e.target.value)}
                    className="w-10 text-center text-xs font-bold text-gray-800 border border-gray-300 rounded px-1 py-0.5"
                  />
                  <button
                    onClick={() => handleQuestionTypeCountChange(item.key, 1)}
                    className="w-6 h-6 bg-blue-600 hover:bg-blue-700 rounded text-xs font-bold text-white"
                  >
                    +
                  </button>
                </div>
              </div>
              {errorMessages[item.key] && (
                <p className="text-xs text-red-600 mt-1 px-2">⚠️ {errorMessages[item.key]}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Short Answer Questions (2-4 marks) */}
      <div className="bg-green-50 p-3 rounded-lg border border-green-200 space-y-3">
        <div className="flex justify-between items-center">
          <p className="font-bold text-gray-800 text-sm">📝 Short Answer Questions</p>
          <span className="text-xs bg-green-600 text-white px-2 py-1 rounded">
            Total: {(config.questionsByMarks?.['2'] || 0) + (config.questionsByMarks?.['3'] || 0) + (config.questionsByMarks?.['4'] || 0)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: '2' as const, label: '2' },
            { key: '3' as const, label: '3' },
            { key: '4' as const, label: '4' }
          ].map(item => (
            <div key={item.key}>
              <div className="flex items-center justify-between bg-white p-2 rounded border border-green-100">
                <span className="font-medium text-gray-700 text-xs">{item.label}m</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleQuestionMarkCountChange(item.key, -1)}
                    className="w-5 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    max={MAX_QUESTIONS_BY_MARKS}
                    value={config.questionsByMarks?.[item.key] || 0}
                    onChange={(e) => handleQuestionMarkInputChange(item.key, e.target.value)}
                    className="w-8 text-center text-xs font-bold text-gray-800 border border-gray-300 rounded px-0.5 py-0.5"
                  />
                  <button
                    onClick={() => handleQuestionMarkCountChange(item.key, 1)}
                    className="w-5 h-5 bg-green-600 hover:bg-green-700 rounded text-xs font-bold text-white"
                  >
                    +
                  </button>
                </div>
              </div>
              {errorMessages[`marks_${item.key}`] && (
                <p className="text-xs text-red-600 mt-0.5 px-2">⚠️ {errorMessages[`marks_${item.key}`]}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Long / Descriptive Answer (5, 6, 10 marks) */}
      <div className="bg-purple-50 p-3 rounded-lg border border-purple-200 space-y-3">
        <div className="flex justify-between items-center">
          <p className="font-bold text-gray-800 text-sm">📄 Long / Descriptive Answer</p>
          <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded">
            Total: {(config.questionsByMarks?.['5'] || 0) + (config.questionsByMarks?.['6'] || 0) + (config.questionsByMarks?.['10'] || 0)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: '5' as const, label: '5' },
            { key: '6' as const, label: '6' },
            { key: '10' as const, label: '10' }
          ].map(item => (
            <div key={item.key}>
              <div className="flex items-center justify-between bg-white p-2 rounded border border-purple-100">
                <span className="font-medium text-gray-700 text-xs">{item.label}m</span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleQuestionMarkCountChange(item.key, -1)}
                    className="w-5 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    max={MAX_QUESTIONS_BY_MARKS}
                    value={config.questionsByMarks?.[item.key] || 0}
                    onChange={(e) => handleQuestionMarkInputChange(item.key, e.target.value)}
                    className="w-8 text-center text-xs font-bold text-gray-800 border border-gray-300 rounded px-0.5 py-0.5"
                  />
                  <button
                    onClick={() => handleQuestionMarkCountChange(item.key, 1)}
                    className="w-5 h-5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-bold text-white"
                  >
                    +
                  </button>
                </div>
              </div>
              {errorMessages[`marks_${item.key}`] && (
                <p className="text-xs text-red-600 mt-0.5 px-2">⚠️ {errorMessages[`marks_${item.key}`]}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderComplete = () => {
    // Find the class label from CLASS_CATEGORIES
    const getClassLabel = () => {
      if (config.studentClass === 'college') {
        return 'College/University';
      }
      for (const category of CLASS_CATEGORIES) {
        const classItem = category.classes.find(c => c.value === config.studentClass);
        if (classItem) {
          return classItem.label;
        }
      }
      return config.studentClass;
    };

    return (
      <div className="animate-fadeIn">
        <div className="bg-green-50 rounded-lg p-4 border-2 border-green-200 text-center space-y-2">
          <p className="text-sm font-bold text-green-700">✓ Ready</p>
          <div className="text-xs space-y-1 text-gray-700">
            <p><span className="font-bold">Class:</span> {getClassLabel()}</p>
            <p><span className="font-bold">Subject:</span> {SUBJECTS.find(s => s.value === config.subject)?.label.split(' ')[0]}</p>
            <p><span className="font-bold">Difficulty:</span> {DIFFICULTIES.find(d => d.value === config.difficulty)?.label.split(' ')[0]}</p>
            {mode === 'custom' && (
              <>
                <p><span className="font-bold">Types:</span> {getTotalQuestionsByType()}</p>
                <p><span className="font-bold">Marks:</span> {getTotalQuestionsByMarks()}</p>
              </>
            )}
          </div>
          <button
            onClick={() => setStep('class')}
            className="mt-2 bg-blue-600 text-white font-bold py-1 px-4 rounded text-xs hover:bg-blue-700"
          >
            Change
          </button>
        </div>
      </div>
    );
  };

  return (
    <div {...swipeHandlers} className="card p-5 md:p-6 space-y-4 animate-fadeIn">
      {/* Header with Progress */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">⚙️ Setup</h2>
        <div className="flex gap-1">
          {Array.from({ length: getTotalSteps() }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all ${
                i < getStepNumber() ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            ></div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-64">
        {step === 'class' && renderClassSelector()}
        {step === 'subject' && renderSubjectSelector()}
        {step === 'difficulty' && renderDifficultySelector()}
        {step === 'customize' && renderCustomizeOptions()}
        {step === 'complete' && renderComplete()}
      </div>

      {/* Navigation */}
      <div className="flex gap-2 justify-between pt-2">
        <button
          onClick={() => {
            if (step === 'subject') goToStep('class');
            else if (step === 'difficulty') goToStep('subject');
            else if (step === 'customize') goToStep('difficulty');
            else if (step === 'complete') goToStep(mode === 'pattern' ? 'difficulty' : 'customize');
          }}
          className={`btn-secondary py-2 px-3 text-xs md:text-sm ${step === 'class' ? 'opacity-0 pointer-events-none' : ''}`}
        >
          ← Back
        </button>
        <button
          onClick={() => {
            if (step === 'class') goToStep('subject');
            else if (step === 'subject') goToStep('difficulty');
            else if (step === 'difficulty') goToStep(mode === 'pattern' ? 'complete' : 'customize');
            else if (step === 'customize') goToStep('complete');
          }}
          className={`btn-primary py-2 px-3 text-xs md:text-sm ${step === 'complete' ? 'opacity-0 pointer-events-none' : ''}`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

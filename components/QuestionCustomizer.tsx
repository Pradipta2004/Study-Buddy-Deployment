'use client';

import { useState } from 'react';
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
  { value: 'mathematics', label: '📐 Mathematics' },
  { value: 'physics', label: '⚛️ Physics' },
  { value: 'chemistry', label: '🧪 Chemistry' },
  { value: 'biology', label: '🧬 Biology' },
  { value: 'computer-science', label: '💻 Computer Science' },
  { value: 'english', label: '📚 English' },
  { value: 'hindi', label: '🇮🇳 Hindi' },
  { value: 'social-science', label: '🌍 Social Science' },
  { value: 'history', label: '📜 History' },
  { value: 'geography', label: '🗺️ Geography' },
  { value: 'political-science', label: '🏛️ Political Science' },
  { value: 'economics', label: '💰 Economics' },
  { value: 'accountancy', label: '📊 Accountancy' },
  { value: 'business-studies', label: '💼 Business Studies' },
  { value: 'statistics', label: '📈 Statistics' },
  { value: 'engineering', label: '⚙️ Engineering' },
  { value: 'environmental-science', label: '🌱 Environmental Science' },
  { value: 'psychology', label: '🧠 Psychology' },
  { value: 'sociology', label: '👥 Sociology' },
  { value: 'philosophy', label: '💭 Philosophy' },
  { value: 'sanskrit', label: '🕉️ Sanskrit' },
  { value: 'general-science', label: '🔬 General Science' },
];

const DIFFICULTIES = [
  { value: 'easy', label: '🟢 Easy' },
  { value: 'medium', label: '🟡 Medium' },
  { value: 'hard', label: '🔴 Hard' },
  { value: 'mixed', label: '🎯 Mixed' },
];

const CLASSES = [
  { value: '6', label: 'Class 6' },
  { value: '7', label: 'Class 7' },
  { value: '8', label: 'Class 8' },
  { value: '9', label: 'Class 9' },
  { value: '10', label: 'Class 10' },
  { value: '11', label: 'Class 11' },
  { value: '12', label: 'Class 12' },
  { value: 'college', label: 'College/University' },
];

type Step = 'class' | 'subject' | 'difficulty' | 'customize' | 'complete';

export default function QuestionCustomizer({ config, onConfigChange, mode }: Props) {
  const [step, setStep] = useState<Step>('class');

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

  const renderClassSelector = () => (
    <div className="animate-fadeIn">
      <h3 className="text-lg font-bold text-gray-800 mb-4">Select Class</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {CLASSES.map(cls => (
          <button
            key={cls.value}
            onClick={() => {
              onConfigChange({ ...config, studentClass: cls.value });
              goToStep('subject');
            }}
            className={`py-3 px-2 rounded-lg font-semibold text-xs md:text-sm transition-all ${
              config.studentClass === cls.value
                ? 'bg-blue-600 text-white shadow-lg'
                : 'bg-sky-100 text-blue-700 hover:bg-sky-200'
            }`}
          >
            {cls.label.replace('Class ', '')}
          </button>
        ))}
      </div>
    </div>
  );

  const renderSubjectSelector = () => (
    <div className="animate-fadeIn">
      <h3 className="text-lg font-bold text-gray-800 mb-4">Select Subject</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
        {SUBJECTS.map(subject => (
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

  const handleQuestionTypeCountChange = (type: keyof NonNullable<QuestionConfig['questionsByType']>, delta: number) => {
    const current = config.questionsByType || { mcq: 0, fillInBlanks: 0, trueFalse: 0, general: 0 };
    const newValue = Math.max(0, (current[type] || 0) + delta);
    onConfigChange({
      ...config,
      questionsByType: { ...current, [type]: newValue }
    });
  };

  const handleQuestionMarkCountChange = (marks: keyof NonNullable<QuestionConfig['questionsByMarks']>, delta: number) => {
    const current = config.questionsByMarks || { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '10': 0 };
    const newValue = Math.max(0, (current[marks] || 0) + delta);
    onConfigChange({
      ...config,
      questionsByMarks: { ...current, [marks]: newValue }
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
      <h3 className="text-lg font-bold text-gray-800 mb-4">Configure Questions</h3>
      
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
            <div key={item.key} className="flex items-center justify-between bg-white p-2 rounded border border-blue-100">
              <span className="font-medium text-gray-700 text-xs">{item.label}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleQuestionTypeCountChange(item.key, -1)}
                  className="w-6 h-6 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >
                  −
                </button>
                <span className="w-5 text-center text-xs font-bold text-gray-800">
                  {config.questionsByType?.[item.key] || 0}
                </span>
                <button
                  onClick={() => handleQuestionTypeCountChange(item.key, 1)}
                  className="w-6 h-6 bg-blue-600 hover:bg-blue-700 rounded text-xs font-bold text-white"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Marks Configuration */}
      <div className="bg-green-50 p-3 rounded-lg border border-green-200 space-y-3">
        <div className="flex justify-between items-center">
          <p className="font-bold text-gray-800 text-sm">By Marks</p>
          <span className="text-xs bg-green-600 text-white px-2 py-1 rounded">Total: {getTotalQuestionsByMarks()}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: '2' as const, label: '2' },
            { key: '3' as const, label: '3' },
            { key: '4' as const, label: '4' },
            { key: '5' as const, label: '5' },
            { key: '6' as const, label: '6' },
            { key: '10' as const, label: '10' }
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between bg-white p-2 rounded border border-green-100">
              <span className="font-medium text-gray-700 text-xs">{item.label}m</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleQuestionMarkCountChange(item.key, -1)}
                  className="w-5 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold"
                >
                  −
                </button>
                <span className="w-4 text-center text-xs font-bold text-gray-800">
                  {config.questionsByMarks?.[item.key] || 0}
                </span>
                <button
                  onClick={() => handleQuestionMarkCountChange(item.key, 1)}
                  className="w-5 h-5 bg-green-600 hover:bg-green-700 rounded text-xs font-bold text-white"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="animate-fadeIn">
      <div className="bg-green-50 rounded-lg p-4 border-2 border-green-200 text-center space-y-2">
        <p className="text-sm font-bold text-green-700">✓ Ready</p>
        <div className="text-xs space-y-1 text-gray-700">
          <p><span className="font-bold">Class:</span> {CLASSES.find(c => c.value === config.studentClass)?.label.replace('Class ', '')}</p>
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

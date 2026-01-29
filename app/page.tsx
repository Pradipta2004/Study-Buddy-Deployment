'use client';

import { useState, useRef } from 'react';
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

export default function Home() {
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<'pattern' | 'custom' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [latexContent, setLatexContent] = useState('');
  const [isFromPattern, setIsFromPattern] = useState(false);
  const [config, setConfig] = useState<QuestionConfig>({
    subject: 'mathematics',
    questionTypes: ['problem-solving', 'conceptual'],
    difficulty: 'mixed',
    studentClass: '10',
  });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patternFileInputRef = useRef<HTMLInputElement>(null);

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
    setError('');
    setLatexContent('');
    setIsFromPattern(!!patternFile); // Track if pattern was uploaded

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
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMessage = 'Upload failed';
        try {
          const errorData = JSON.parse(text);
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = text || errorMessage;
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

      setLatexContent(data.latex);
    } catch (err: any) {
      setError(err.message || 'An error occurred during upload');
    } finally {
      setLoading(false);
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
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Format: studdybuddy_subjectname_class_date
      const dateStr = new Date().toISOString().split('T')[0];
      const sanitizedSubject = config.subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = config.studentClass.replace(/[^a-z0-9]+/g, '');
      a.download = `studdybuddy_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
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
          <p className="text-xs md:text-sm opacity-90">AI-Powered Question Generator</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* Get Started Screen */}
        {!started ? (
          <div className="card p-8 md:p-12 text-center space-y-8 animate-fadeIn">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold text-gray-800">Welcome</h2>
              <p className="text-base md:text-lg text-gray-600">Create Question Paper from your Textbook Instantly</p>
            </div>
            <button
              onClick={() => setStarted(true)}
              className="bg-gradient-to-r from-blue-600 to-sky-500 text-white font-bold py-4 px-8 rounded-xl hover:shadow-lg transition-all transform hover:scale-105 text-lg md:text-xl w-full md:w-auto inline-block"
            >
              Get Started →
            </button>
          </div>
        ) : !mode ? (
          /* Mode Selection Screen */
          <div className="card p-8 md:p-12 space-y-8 animate-fadeIn">
            <div className="text-center space-y-2">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-800">How would you like to generate questions?</h2>
              <p className="text-gray-600">Choose a method that works best for you</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Without Pattern */}
              <button
                onClick={() => setMode('custom')}
                className="p-8 border-2 border-blue-200 rounded-xl hover:border-blue-600 hover:shadow-lg transition-all text-left space-y-4 group"
              >
                <div className="text-4xl">⚙️</div>
                <h3 className="text-xl font-bold text-gray-800 group-hover:text-blue-600">Make your own Practice Question Paper</h3>
                <p className="text-sm text-gray-600">Choose class, subject, and difficulty level</p>
                <p className="text-xs text-gray-500">Select specific question types and numbers</p>
              </button>
              {/* With Pattern */}
              <button
                onClick={() => setMode('pattern')}
                className="p-8 border-2 border-purple-200 rounded-xl hover:border-purple-600 hover:shadow-lg transition-all text-left space-y-4 group"
              >
                <div className="text-4xl">📋</div>
                <h3 className="text-xl font-bold text-gray-800 group-hover:text-purple-600">Upload Your Template Exam Question Paper</h3>
                <p className="text-sm text-gray-600">Upload a sample paper to match</p>
                <p className="text-xs text-gray-500">Replicates format, structure, and style</p>
              </button>
            </div>
            <button
              onClick={() => setStarted(false)}
              className="text-gray-500 hover:text-gray-700 text-sm font-semibold text-center w-full"
            >
              ← Back
            </button>
          </div>
        ) : (
          <>
            {/* Question Customizer - Only for Custom Mode */}
            {mode === 'custom' && (
              <QuestionCustomizer config={config} onConfigChange={setConfig} mode="custom" />
            )}

            {/* Question Customizer - For Pattern Mode (only class/subject/difficulty) */}
            {mode === 'pattern' && (
              <QuestionCustomizer config={config} onConfigChange={setConfig} mode="pattern" />
            )}

            {/* Upload Section */}
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
                      <p className="text-sm md:text-base text-gray-600">Click to upload sample paper</p>
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
                  <p className="text-xs md:text-sm text-gray-500">Max 16MB</p>
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

              {/* Back to Mode Selection */}
              <button
                onClick={() => {
                  setMode(null);
                  setFile(null);
                  setPatternFile(null);
                  setLatexContent('');
                  setError('');
                }}
                className="text-gray-500 hover:text-gray-700 text-sm font-semibold text-center w-full mt-2"
              >
                ← Back to Options
              </button>
            </div>

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
                <div className="card p-6 md:p-8 space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-800">✅ Generated</h2>
                    <div className="flex gap-2 w-full md:w-auto flex-wrap">
                      <button
                        onClick={handleDownloadLatex}
                        className="btn-secondary flex-1 md:flex-none py-2 md:py-3 px-4 md:px-6 text-sm md:text-base"
                      >
                        📥 LaTeX
                      </button>
                      <button
                        onClick={() => handleDownloadPDF(false)}
                        disabled={loading}
                        className="btn-secondary flex-1 md:flex-none py-2 md:py-3 px-4 md:px-6 text-sm md:text-base disabled:opacity-50"
                      >
                        📄 Questions
                      </button>
                      <button
                        onClick={() => handleDownloadPDF(true)}
                        disabled={loading}
                        className="btn-primary flex-1 md:flex-none py-2 md:py-3 px-4 md:px-6 text-sm md:text-base disabled:opacity-50"
                      >
                        📚 With Solution
                      </button>
                    </div>
                  </div>

                  {!isFromPattern && <LatexPreview content={latexContent} />}
                  {isFromPattern && (
                    <div className="text-center space-y-3 py-8">
                      <div className="text-5xl">✓</div>
                      <p className="text-lg font-bold text-gray-800">Generated Successfully</p>
                      <p className="text-sm text-gray-600">Download using options above</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Loading Indicator */}
            {loading && !latexContent && (
              <div className="card p-12 text-center space-y-4">
                <div className="inline-block w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-lg text-gray-700 font-semibold">Processing...</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-blue-100 bg-white/50 mt-12 py-6 text-center text-sm text-gray-600">
        <p>© 2026 STUDYBUDDY</p>
      </footer>
    </div>
  );
}

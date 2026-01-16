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
  const [file, setFile] = useState<File | null>(null);
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [latexContent, setLatexContent] = useState('');
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
        body: JSON.stringify({ latex: latexContent, includeSolutions }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'PDF generation failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `math_questions_${Date.now()}.pdf`;
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
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-indigo-700 to-purple-800 py-4 sm:py-8 px-3 sm:px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="text-center text-white mb-8 sm:mb-12">
          <div className="mb-4">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold mb-2 drop-shadow-2xl bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 via-pink-300 to-purple-300">
              📚 STUDYBUDDY
            </h1>
            <div className="inline-block bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
              <p className="text-xs sm:text-sm font-semibold text-yellow-200">
                ⚡ Powered by INFOTECH SERVICES
              </p>
            </div>
          </div>
          <p className="text-lg sm:text-xl md:text-2xl opacity-90 font-medium">
            Generate customized questions from your textbooks using AI
          </p>
          <p className="text-sm sm:text-base opacity-80 mt-2">
            Smart. Fast. Personalized for Every Student.
          </p>
        </header>

        {/* Question Customizer */}
        <QuestionCustomizer config={config} onConfigChange={setConfig} />

        {/* Upload Section */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 text-gray-800">
            📤 Upload Your Files
          </h2>

          {/* Pattern File Upload - Optional */}
          <div className="mb-6 sm:mb-8 bg-gradient-to-r from-purple-50 to-pink-50 p-4 sm:p-6 rounded-xl border-2 border-purple-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-semibold text-gray-800">
                  📋 Question Paper Pattern (Recommended)
                </h3>
                <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded-full font-semibold">
                  EXACT MATCH
                </span>
              </div>
              {patternFile && (
                <button
                  onClick={() => setPatternFile(null)}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  ✕ Remove
                </button>
              )}
            </div>
            <p className="text-xs sm:text-sm text-gray-700 mb-3 font-medium">
              ✨ Upload a sample question paper and AI will replicate its <span className="text-purple-700 font-bold">EXACT</span> format, structure, instructions, marking scheme, section divisions, and presentation style!
            </p>
            <div className="bg-purple-100 border border-purple-300 rounded-lg p-3 mb-3">
              <p className="text-xs text-purple-900 font-semibold mb-2">🎯 What gets replicated:</p>
              <ul className="text-xs text-purple-800 space-y-1 ml-4 list-disc">
                <li>Header format, title, institution name</li>
                <li>Instructions (word-for-word)</li>
                <li>Section structure and divisions</li>
                <li>Question numbering style</li>
                <li>Mark allocation format</li>
                <li>MCQ, Fill-in-blanks, True/False formats</li>
                <li>Overall layout and spacing</li>
              </ul>
            </div>
            <div
              className="border-2 border-dashed rounded-lg p-4 sm:p-6 text-center cursor-pointer transition-all border-purple-400 bg-white hover:bg-purple-50 hover:border-purple-600"
              onClick={() => patternFileInputRef.current?.click()}
            >
              <div className="text-3xl sm:text-4xl mb-2">📋</div>
              <div className="text-sm sm:text-base text-gray-700">
                {patternFile ? (
                  <div>
                    <span className="font-semibold text-purple-600">{patternFile.name}</span>
                    <p className="text-xs text-green-600 mt-1">✓ Pattern loaded - AI will match this format exactly!</p>
                  </div>
                ) : (
                  <div>
                    <span className="font-semibold">Click to upload sample question paper</span>
                    <p className="text-xs text-gray-500 mt-1">Get exact format replication!</p>
                  </div>
                )}
              </div>
              <input
                ref={patternFileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handlePatternFileChange}
                className="hidden"
              />
            </div>
          </div>

          {/* Main Textbook Upload */}
          <h3 className="text-base sm:text-lg font-semibold text-gray-700 mb-3">
            📚 Textbook/Study Material (Required)
          </h3>

          <div
            className={`border-3 sm:border-4 border-dashed rounded-lg sm:rounded-xl p-6 sm:p-12 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-blue-600 bg-blue-50 scale-105'
                : 'border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50 hover:bg-blue-100'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-4xl sm:text-6xl mb-3 sm:mb-4">📄</div>
            <div className="text-base sm:text-xl text-gray-700 mb-2 px-2">
              {file ? <span className="font-semibold text-blue-600">{file.name}</span> : 'Drop your PDF file here or click to browse'}
            </div>
            <div className="text-xs sm:text-sm text-gray-500">
              Maximum file size: 16MB • Supports PDFs only
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="mt-4 sm:mt-6 text-center">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || loading}
              className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white px-8 sm:px-12 py-3 sm:py-4 rounded-full text-base sm:text-lg font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 w-full sm:w-auto"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 sm:w-5 sm:h-5 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
                  Generating Questions...
                </span>
              ) : (
                '✨ Generate Questions Now'
              )}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 shadow-lg animate-fadeIn">
            <div className="flex items-start gap-3">
              <span className="text-2xl sm:text-3xl">⚠️</span>
              <div>
                <h3 className="font-bold text-red-800 text-base sm:text-lg mb-1">Error Occurred</h3>
                <p className="text-red-700 text-sm sm:text-base">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        {latexContent && (
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 animate-fadeIn">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
                ✅ Generated Questions
              </h2>
              <div className="flex gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleDownloadLatex}
                  className="bg-blue-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-lg text-sm sm:text-base font-semibold shadow hover:bg-blue-700 transition-all hover:scale-105 flex-1 sm:flex-none"
                >
                  📥 LaTeX
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPDF(false)}
                  disabled={loading}
                  className="bg-green-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-lg text-sm sm:text-base font-semibold shadow hover:bg-green-700 transition-all disabled:opacity-50 hover:scale-105 flex-1 sm:flex-none"
                >
                  {loading ? 'Compiling...' : '📄 PDF (Q)'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPDF(true)}
                  disabled={loading}
                  className="bg-purple-600 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-lg text-sm sm:text-base font-semibold shadow hover:bg-purple-700 transition-all disabled:opacity-50 hover:scale-105 flex-1 sm:flex-none"
                >
                  {loading ? 'Compiling...' : '📚 PDF (Q+S)'}
                </button>
              </div>
            </div>

            <LatexPreview content={latexContent} />
          </div>
        )}

        {/* Loading Indicator */}
        {loading && !latexContent && (
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-8 sm:p-12 text-center">
            <div className="inline-block w-12 h-12 sm:w-16 sm:h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-lg sm:text-xl text-gray-700">
              Processing your textbook and generating questions...
            </p>
            <p className="text-xs sm:text-sm text-gray-500 mt-2">
              This may take a minute or two ⏱️
            </p>
          </div>
        )}
        
        {/* Footer */}
        <footer className="text-center text-white/80 mt-8 sm:mt-12 pb-4">
          <p className="text-xs sm:text-sm">
            © 2026 STUDYBUDDY • Powered by INFOTECH SERVICES • All Rights Reserved
          </p>
        </footer>
      </div>
    </div>
  );
}

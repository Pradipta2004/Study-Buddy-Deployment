'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import LatexPreview from '@/components/LatexPreview';

const SUBJECTS = [
  { value: 'mathematics', label: 'गणित' },
  { value: 'physics', label: 'भौतिक विज्ञान' },
  { value: 'chemistry', label: 'रसायन विज्ञान' },
  { value: 'biology', label: 'जीव विज्ञान' },
  { value: 'physical-science', label: 'भौतिक विज्ञान (सामान्य)' },
  { value: 'life-science', label: 'जीव विज्ञान (सामान्य)' },
  { value: 'hindi', label: 'हिंदी' },
  { value: 'english', label: 'अंग्रेज़ी' },
  { value: 'history', label: 'इतिहास' },
  { value: 'geography', label: 'भूगोल' },
  { value: 'economics', label: 'अर्थशास्त्र' },
  { value: 'computer-science', label: 'कम्प्यूटर विज्ञान' },
  { value: 'environmental-science', label: 'पर्यावरण विज्ञान' },
  { value: 'political-science', label: 'राजनीति विज्ञान' },
  { value: 'accountancy', label: 'लेखाशास्त्र' },
  { value: 'business-studies', label: 'व्यवसाय अध्ययन' },
  { value: 'psychology', label: 'मनोविज्ञान' },
  { value: 'sociology', label: 'समाजशास्त्र' },
  { value: 'statistics', label: 'सांख्यिकी' },
  { value: 'science', label: 'विज्ञान (सामान्य)' },
  { value: 'social-science', label: 'सामाजिक विज्ञान' },
  { value: 'others', label: 'अन्य' },
];

const CLASSES = [
  { value: '4', label: 'कक्षा 4' },
  { value: '5', label: 'कक्षा 5' },
  { value: '6', label: 'कक्षा 6' },
  { value: '7', label: 'कक्षा 7' },
  { value: '8', label: 'कक्षा 8' },
  { value: '9', label: 'कक्षा 9' },
  { value: '10', label: 'कक्षा 10' },
  { value: '11', label: 'कक्षा 11' },
  { value: '12', label: 'कक्षा 12' },
  { value: 'college', label: 'कॉलेज / विश्वविद्यालय' },
];

export default function HindiCheatsheet() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState('science');
  const [studentClass, setStudentClass] = useState('10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [latexContent, setLatexContent] = useState('');
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tokenUsage, setTokenUsage] = useState<{ promptTokens: number; outputTokens: number; totalTokens: number } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const progressRef = useRef<NodeJS.Timeout | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setError('कृपया PDF फ़ाइल चुनें'); return; }
    setFile(f);
    setError('');
  };

  const handleGenerate = async () => {
    if (!file) { setError('कृपया पहले PDF अपलोड करें'); return; }
    setLoading(true);
    setError('');
    setLatexContent('');
    setDone(false);
    setProgress(0);

    if (progressRef.current) clearInterval(progressRef.current);
    let p = 0;
    progressRef.current = setInterval(() => {
      p += Math.random() * 15;
      if (p > 88) p = 88;
      setProgress(Math.round(p));
    }, 800);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('subject', subject);
      fd.append('studentClass', studentClass);

      const res = await fetch('/api/hindi-cheatsheet', { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error (${res.status})`);
      }
      const data = await res.json();
      if (!data.latex) throw new Error('कोई उत्तर नहीं मिला। कृपया पुनः प्रयास करें।');
      setLatexContent(data.latex);
      if (data.tokenUsage) setTokenUsage(data.tokenUsage);
      setProgress(100);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'चीटशीट बनाने में समस्या हुई।');
    } finally {
      setLoading(false);
      if (progressRef.current) clearInterval(progressRef.current);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      setError('');
      setPdfLoading(true);
      const response = await fetch('/api/download-hindi-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: latexContent,
          subject,
          studentClass,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'PDF generation failed');
      }

      const blob = await response.blob();
      const dateStr = new Date().toISOString().split('T')[0];
      const sanitizedSubject = subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = studentClass.replace(/[^a-z0-9]+/g, '');
      const filename = `hindi_cheatsheet_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

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
            setPdfLoading(false);
            return;
          }
        } catch (linkErr) {
          console.log('Direct link method failed:', linkErr);
        }
        try {
          const reader = new FileReader();
          reader.onloadend = function () {
            const base64data = reader.result as string;
            const newWindow = window.open('', '_blank');
            if (newWindow) newWindow.location.href = base64data;
            else window.location.href = base64data;
          };
          reader.readAsDataURL(blob);
          await new Promise(resolve => setTimeout(resolve, 500));
          setPdfLoading(false);
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
      setError(err.message || 'PDF download failed');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setLatexContent('');
    setDone(false);
    setError('');
    setProgress(0);
    setTokenUsage(null);
  };

  const subjectLabel = SUBJECTS.find(s => s.value === subject)?.label || subject;
  const classLabel = CLASSES.find(c => c.value === studentClass)?.label || studentClass;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/')}
            className="text-gray-500 hover:text-gray-800 text-sm font-medium"
          >
            ← वापस जाएं
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-base font-bold text-gray-800">📋 हिंदी चीटशीट जेनरेटर</h1>
        </div>
        <span className="text-xs text-gray-400">Study Buddy</span>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {!done ? (
          /* ===== INPUT FORM ===== */
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-gray-800">हिंदी में चीटशीट बनाएं</h2>
              <p className="text-sm text-gray-500 mt-1">
                अपनी पाठ्यपुस्तक PDF अपलोड करें — हम हिंदी में संपूर्ण नोट्स तैयार करेंगे।
              </p>
            </div>

            {/* Class & Subject */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">कक्षा</label>
                <select
                  value={studentClass}
                  onChange={e => setStudentClass(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">विषय</label>
                <select
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {SUBJECTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {/* PDF Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PDF अपलोड करें</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div className="text-3xl mb-2">📄</div>
                {file ? (
                  <p className="text-sm font-medium text-blue-700">{file.name}</p>
                ) : (
                  <p className="text-sm text-gray-500">क्लिक करें या PDF यहाँ खींचें</p>
                )}
                <p className="text-xs text-red-500 mt-1">अधिकतम 7 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            </div>

            {/* What you get */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 space-y-1">
              <p className="font-semibold mb-2">📌 आपकी चीटशीट में क्या होगा:</p>
              <div className="grid grid-cols-1 gap-1 text-xs">
                <div>✓ हर अध्याय के महत्वपूर्ण विषय और अवधारणाएं (हिंदी में)</div>
                <div>✓ सभी परिभाषाएं और तकनीकी शब्द</div>
                <div>✓ सूत्र, समीकरण और नियम (STEM विषयों के लिए)</div>
                <div>✓ तुलनात्मक तालिकाएं और वर्गीकरण</div>
                <div>✓ महत्वपूर्ण तथ्य और याद रखने योग्य बिंदु</div>
                <div>✓ 5 अंक वाले प्रश्नों के लिए तैयार नोट्स</div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-700">
                ⚠️ {error}
              </div>
            )}

            {/* Progress bar (during loading) */}
            {loading && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>चीटशीट बन रही है...</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 text-center">
                  इसमें 1-2 मिनट लग सकते हैं। कृपया प्रतीक्षा करें…
                </p>
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={!file || loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  बन रही है...
                </span>
              ) : '📋 चीटशीट बनाएं'}
            </button>
          </div>
        ) : (
          /* ===== RESULTS ===== */
          <>
            {/* Success header */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl">✅</span>
                <div>
                  <h2 className="text-lg font-bold text-gray-800">चीटशीट तैयार है!</h2>
                  <p className="text-xs text-gray-500">{subjectLabel} — {classLabel}</p>
                </div>
              </div>

              {/* Token usage */}
              {tokenUsage && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs border-t border-gray-100 pt-3">
                  <div>
                    <p className="font-bold text-gray-700">{tokenUsage.promptTokens.toLocaleString()}</p>
                    <p className="text-gray-400">Input tokens</p>
                  </div>
                  <div>
                    <p className="font-bold text-gray-700">{tokenUsage.outputTokens.toLocaleString()}</p>
                    <p className="text-gray-400">Output tokens</p>
                  </div>
                  <div>
                    <p className="font-bold text-gray-700">{tokenUsage.totalTokens.toLocaleString()}</p>
                    <p className="text-gray-400">कुल tokens</p>
                  </div>
                </div>
              )}
            </div>

            {/* LaTeX Preview & Download */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
              <h3 className="text-base font-bold text-gray-800">✅ Preview</h3>

              {/* LaTeX Preview */}
              <div className="border border-blue-200 rounded-xl p-4 bg-white max-h-96 overflow-y-auto">
                <LatexPreview content={latexContent} />
              </div>

              {/* Download PDF */}
              <div className="bg-blue-50 p-5 rounded-xl border border-blue-200 space-y-3">
                <h4 className="text-sm font-bold text-gray-800">📥 PDF डाउनलोड करें</h4>
                <button
                  onClick={handleDownloadPDF}
                  disabled={pdfLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {pdfLoading ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      PDF तैयार हो रही है...
                    </>
                  ) : (
                    <>📄 PDF डाउनलोड करें</>
                  )}
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-700">
                  ⚠️ {error}
                </div>
              )}
            </div>

            {/* Bottom action row */}
            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                🔄 नई चीटशीट
              </button>
              <button
                onClick={() => router.push('/')}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                🏠 होम
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

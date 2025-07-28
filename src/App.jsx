import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Scatter, Label } from 'recharts';
import { utils, writeFile } from 'xlsx';
import { ArrowDownToLine, Settings, FileDown, RefreshCw, HelpCircle, X } from 'lucide-react';

// Main App Component
const App = () => {
    // Initial state based on Table 17 from the PDF
    const [inputs, setInputs] = useState({
        plsFlow: 400,
        plsCu: 7.0,
        plsAcid: 1.96,
        percentageML: 80,
        o_a_ex: 1.25,
        effE1: 95,
        effE2: 95,
        spCu: 35,
        spAcid: 190,
        adCu: 50,
        effS1: 98,
        effS2: 98,
    });

    const [results, setResults] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isHelpVisible, setIsHelpVisible] = useState(false);
    const [initialRun, setInitialRun] = useState(false);


    // Function to handle input changes
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setInputs(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
    };

    // Core calculation logic from the PDF
    const runSolver = useCallback(() => {
        setIsLoading(true);
        setError(null);
        setResults(null);
        setInitialRun(true);

        // This is a web-worker compatible function to avoid freezing the UI
        const calculationTask = () => {
            try {
                // Numerical solver to find the root of the objective function
                const solve = (objectiveFunc, initialGuess, tolerance = 1e-7, maxIterations = 100) => {
                    let x0 = initialGuess - 0.1;
                    let x1 = initialGuess + 0.1;
                    if (x0 <= 0) x0 = 0.1; // Ensure guess is positive

                    let f0 = objectiveFunc(x0);
                    let f1 = objectiveFunc(x1);

                    for (let i = 0; i < maxIterations; i++) {
                        if (Math.abs(f1) < tolerance) return x1;
                        let x2 = x1 - f1 * (x1 - x0) / (f1 - f0);
                        if (isNaN(x2) || !isFinite(x2) || x2 <= 0) {
                           throw new Error("محاسبات واگرا شد یا به یک نتیجه نامعتبر رسید. لطفاً ورودی‌ها را بررسی کنید.");
                        }
                        x0 = x1;
                        f0 = f1;
                        x1 = x2;
                        f1 = objectiveFunc(x1);
                    }
                    throw new Error(`بهینه‌سازی پس از ${maxIterations} تکرار به همگرایی نرسید.`);
                };

                // Objective function to be minimized (SO_ex - SO_st = 0)
                const objectiveFunction = (V_percent_guess) => {
                    const res = calculateAll(inputs, V_percent_guess, solve);
                    if (!res) return 1e9; // Return a large number if calculation fails
                    return res.constraints.so_consistency;
                };

                // Find the optimal V%
                const optimalVPercent = solve(objectiveFunction, 17.1); // Initial guess from PDF
                if (optimalVPercent <= 0 || optimalVPercent > 50) {
                     throw new Error("درصد بهینه استخراج‌کننده خارج از محدوده قابل قبول است (0-50%). ورودی‌ها را بررسی کنید.");
                }
                
                // Final calculation with optimal V%
                const finalResults = calculateAll(inputs, optimalVPercent, solve);
                
                // Post results back to the main thread
                setTimeout(() => {
                    setResults(finalResults);
                    setIsLoading(false);
                }, 0);

            } catch (e) {
                 setTimeout(() => {
                    setError(e.message);
                    setIsLoading(false);
                }, 0);
            }
        };
        
        // Run calculation in a timeout to simulate async operation
        setTimeout(calculationTask, 50);

    }, [inputs]);
    
    // Export to Excel function with full details
    const exportToExcel = () => {
        if (!results) {
            alert("ابتدا باید محاسبات انجام شود.");
            return;
        }
        
        const wb = utils.book_new();

        // --- Summary Sheet ---
        const summaryData = [
            { 'پارامتر': 'درصد بهینه استخراج‌کننده (V%)', 'مقدار': results.v_percent.toFixed(2) },
            { 'پارامتر': 'انتقال خالص مس ((g/L)/V%)', 'مقدار': results.stripping.netCu.toFixed(3) },
            { 'پارامتر': 'بازیابی استخراج (%)', 'مقدار': results.extraction.recovery.toFixed(2) },
            { 'پارامتر': 'بازیابی استریپینگ (%)', 'مقدار': results.stripping.recovery.toFixed(2) },
            { 'پارامتر': 'بارگذاری ماکزیمم (ML g/L)', 'مقدار': results.extraction.ml.toFixed(3) },
            { 'پارامتر': 'بارگذاری شده (LO g/L)', 'مقدار': results.extraction.lo.toFixed(3) },
            { 'پارامتر': 'رافینت (Raff g/L)', 'مقدار': results.extraction.raff.toFixed(3) },
            { 'پارامتر': 'اسید در رافینت (g/L)', 'مقدار': results.extraction.details.raffAcid.toFixed(3) },
            { 'پارامتر': 'O/A استریپینگ', 'مقدار': results.stripping.details.o_a_st.toFixed(3) },
        ];
        const wsSummary = utils.json_to_sheet(summaryData);
        utils.book_append_sheet(wb, wsSummary, 'خلاصه نتایج');

        // --- Extraction Details Sheet ---
        const exDetails = [
            ["مرحله استخراج"],
            ["نقطه", "Cu آبی (g/L)", "Cu آلی (g/L)"],
            ["A1 (ورودی)", results.extraction.details.stage1.A.x.toFixed(3), results.extraction.details.stage1.A.y.toFixed(3)],
            ["B1 (خروجی واقعی)", results.extraction.details.stage1.B.x.toFixed(3), results.extraction.details.stage1.B.y.toFixed(3)],
            ["C1 (ورودی آلی)", results.extraction.details.stage1.C.x.toFixed(3), results.extraction.details.stage1.C.y.toFixed(3)],
            ["D1 (تعادل)", results.extraction.details.stage1.D.x.toFixed(3), results.extraction.details.stage1.D.y.toFixed(3)],
            ["بازدهی مرحله ۱ (%)", results.extraction.details.stage1.efficiency.toFixed(2), ""],
            [],
            ["A2 (ورودی)", results.extraction.details.stage2.A.x.toFixed(3), results.extraction.details.stage2.A.y.toFixed(3)],
            ["B2 (خروجی واقعی)", results.extraction.details.stage2.B.x.toFixed(3), results.extraction.details.stage2.B.y.toFixed(3)],
            ["C2 (ورودی آلی)", results.extraction.details.stage2.C.x.toFixed(3), results.extraction.details.stage2.C.y.toFixed(3)],
            ["D2 (تعادل)", results.extraction.details.stage2.D.x.toFixed(3), results.extraction.details.stage2.D.y.toFixed(3)],
            ["بازدهی مرحله ۲ (%)", results.extraction.details.stage2.efficiency.toFixed(2), ""],
        ];
        const wsEx = utils.aoa_to_sheet(exDetails);
        utils.book_append_sheet(wb, wsEx, 'جزئیات استخراج');
        
        // --- Stripping Details Sheet ---
        const stDetails = [
            ["مرحله استریپینگ"],
            ["نقطه", "Cu آبی (g/L)", "Cu آلی (g/L)"],
            ["A1 (ورودی)", results.stripping.details.stage1.A.x.toFixed(3), results.stripping.details.stage1.A.y.toFixed(3)],
            ["B1 (خروجی واقعی)", results.stripping.details.stage1.B.x.toFixed(3), results.stripping.details.stage1.B.y.toFixed(3)],
            ["C1 (ورودی آلی)", results.stripping.details.stage1.C.x.toFixed(3), results.stripping.details.stage1.C.y.toFixed(3)],
            ["D1 (تعادل)", results.stripping.details.stage1.D.x.toFixed(3), results.stripping.details.stage1.D.y.toFixed(3)],
            ["بازدهی مرحله ۱ (%)", results.stripping.details.stage1.efficiency.toFixed(2), ""],
            [],
            ["A2 (ورودی)", results.stripping.details.stage2.A.x.toFixed(3), results.stripping.details.stage2.A.y.toFixed(3)],
            ["B2 (خروجی واقعی)", results.stripping.details.stage2.B.x.toFixed(3), results.stripping.details.stage2.B.y.toFixed(3)],
            ["C2 (ورودی آلی)", results.stripping.details.stage2.C.x.toFixed(3), results.stripping.details.stage2.C.y.toFixed(3)],
            ["D2 (تعادل)", results.stripping.details.stage2.D.x.toFixed(3), results.stripping.details.stage2.D.y.toFixed(3)],
            ["بازدهی مرحله ۲ (%)", results.stripping.details.stage2.efficiency.toFixed(2), ""],
        ];
        const wsSt = utils.aoa_to_sheet(stDetails);
        utils.book_append_sheet(wb, wsSt, 'جزئیات استریپینگ');
        
        writeFile(wb, "Copper_SX_Optimization_Full_Details.xlsx");
    };

    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen font-sans p-4 md:p-8">
            {isHelpVisible && <HelpModal onClose={() => setIsHelpVisible(false)} />}
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-center mb-8 pb-4 border-b border-gray-700">
                    <div>
                        <h1 className="text-3xl font-bold text-cyan-400">بهینه‌ساز فرآیند استخراج حلالی مس</h1>
                        <p className="text-gray-400 mt-1">ابزار شبیه‌سازی و بهینه‌سازی بر اساس مدل نیمه‌تجربی</p>
                        <p className="text-gray-500 mt-2 text-sm">طراح: میلاد جهانی</p>
                    </div>
                    <div className="flex items-center space-x-2 mt-4 md:mt-0">
                         <button onClick={() => setIsHelpVisible(true)} className="flex items-center bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                            <HelpCircle size={18} className="ml-2" />
                            راهنمای برنامه
                        </button>
                        <button 
                            onClick={exportToExcel} 
                            disabled={!results} 
                            className="flex items-center bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
                        >
                            <FileDown size={18} className="ml-2" />
                            خروجی اکسل
                        </button>
                         <button onClick={runSolver} className="flex items-center bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                            {isLoading ? <RefreshCw size={18} className="ml-2 animate-spin" /> : <Settings size={18} className="ml-2" />}
                            {isLoading ? 'در حال محاسبه...' : 'محاسبه'}
                        </button>
                    </div>
                </header>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Input Panel */}
                    <div className="lg:col-span-1 bg-gray-800 p-6 rounded-xl shadow-lg">
                        <h2 className="text-xl font-semibold mb-4 text-cyan-400 flex items-center"><Settings size={20} className="ml-2"/> پارامترهای ورودی</h2>
                        <div className="space-y-4">
                            {/* Extraction Inputs */}
                            <div>
                                <h3 className="font-bold text-gray-300 border-b border-gray-600 pb-1 mb-2">مرحله استخراج (Extraction)</h3>
                                <InputRow label="جریان PLS (m³/h)" name="plsFlow" value={inputs.plsFlow} onChange={handleInputChange} />
                                <InputRow label="مس در PLS (g/L)" name="plsCu" value={inputs.plsCu} onChange={handleInputChange} />
                                <InputRow label="اسید در PLS (g/L)" name="plsAcid" value={inputs.plsAcid} onChange={handleInputChange} />
                                <InputRow label="درصد بارگذاری ماکزیمم (%)" name="percentageML" value={inputs.percentageML} onChange={handleInputChange} />
                                <InputRow label="نسبت O/A" name="o_a_ex" value={inputs.o_a_ex} onChange={handleInputChange} />
                                <InputRow label="بازدهی مرحله E1 (%)" name="effE1" value={inputs.effE1} onChange={handleInputChange} />
                                <InputRow label="بازدهی مرحله E2 (%)" name="effE2" value={inputs.effE2} onChange={handleInputChange} />
                            </div>
                            {/* Stripping Inputs */}
                            <div>
                                <h3 className="font-bold text-gray-300 border-b border-gray-600 pb-1 mb-2">مرحله استریپینگ (Stripping)</h3>
                                <InputRow label="مس در الکترولیت مصرفی (g/L)" name="spCu" value={inputs.spCu} onChange={handleInputChange} />
                                <InputRow label="اسید در الکترولیت مصرفی (g/L)" name="spAcid" value={inputs.spAcid} onChange={handleInputChange} />
                                <InputRow label="مس در الکترولیت پیشرفته (g/L)" name="adCu" value={inputs.adCu} onChange={handleInputChange} />
                                <InputRow label="بازدهی مرحله S1 (%)" name="effS1" value={inputs.effS1} onChange={handleInputChange} />
                                <InputRow label="بازدهی مرحله S2 (%)" name="effS2" value={inputs.effS2} onChange={handleInputChange} />
                            </div>
                        </div>
                    </div>

                    {/* Results and Charts */}
                    <div className="lg:col-span-2">
                         {!initialRun && <div className="flex flex-col justify-center items-center h-96 bg-gray-800 rounded-xl text-center"><Settings size={48} className="text-cyan-500 mb-4" /><h3 className="text-xl text-gray-300">آماده برای بهینه‌سازی</h3><p className="text-gray-400 mt-2">مقادیر ورودی را تنظیم کرده و روی دکمه "محاسبه" کلیک کنید.</p></div>}
                         {isLoading && <div className="flex justify-center items-center h-96 bg-gray-800 rounded-xl"><div className="text-cyan-400 text-lg">در حال انجام محاسبات پیچیده...</div></div>}
                         {error && <div className="flex justify-center items-center h-96 bg-red-900/50 text-red-300 p-4 rounded-xl">{error}</div>}
                         {results && !isLoading && !error && (
                            <div className="space-y-8">
                                <ResultsSummary results={results} />
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                                    <ChartCard title="نمودار McCabe-Thiele: استخراج" data={results.extraction.mccabeThiele} />
                                    <ChartCard title="نمودار McCabe-Thiele: استریپینگ" data={results.stripping.mccabeThiele} />
                                </div>
                            </div>
                         )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const HelpModal = ({ onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
            <div className="bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-cyan-400">راهنمای برنامه</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>
                <div className="space-y-4 text-gray-300 text-right">
                    <p>با سلام، من، **میلاد جهانی**، این برنامه را به عنوان یک ابزار مهندسی برای شبیه‌سازی و بهینه‌سازی مدارهای استخراج حلالی مس (SX) طراحی کرده‌ام. هسته محاسباتی آن بر اساس یک مدل معتبر نیمه‌تجربی برای استخراج‌کننده Lix984N پیاده‌سازی شده است.</p>
                    
                    <h3 className="text-lg font-semibold text-cyan-500 pt-2 border-t border-gray-700">نحوه کار</h3>
                    <p>هدف اصلی من از طراحی این برنامه، ایجاد ابزاری بود که با دریافت پارامترهای ورودی مدار، مقدار بهینه **درصد استخراج‌کننده (V%)** را به گونه‌ای محاسبه کند که مدار به پایدارترین حالت خود برسد. این پایداری بر اساس شرط برابری غلظت مس در فاز آلی ورودی و خروجی مدار (`SO_extraction = SO_stripping`) تعریف شده است. سپس تمام پارامترهای عملکردی مدار بر اساس این مقدار بهینه محاسبه و نمایش داده می‌شود.</p>

                    <h3 className="text-lg font-semibold text-cyan-500 pt-2 border-t border-gray-700">پارامترهای ورودی</h3>
                    <ul className="list-disc list-inside space-y-2 pr-4">
                        <li><strong className="text-gray-100">جریان PLS:</strong> دبی محلول باردار حامل مس ورودی به مدار.</li>
                        <li><strong className="text-gray-100">مس و اسید در PLS:</strong> غلظت مس و اسید سولفوریک در محلول ورودی.</li>
                        <li><strong className="text-gray-100">درصد بارگذاری ماکزیمم (%ML):</strong> درصدی از حداکثر ظرفیت بارگذاری فاز آلی که در عمل به آن می‌رسیم. این پارامتر برای کنترل میزان استخراج آهن اهمیت دارد.</li>
                        <li><strong className="text-gray-100">نسبت O/A:</strong> نسبت فاز آلی به آبی در مرحله استخراج.</li>
                        <li><strong className="text-gray-100">بازدهی مراحل (Eff):</strong> بازدهی هر مرحله میکسر-ستر در رسیدن به تعادل.</li>
                        <li><strong className="text-gray-100">مس و اسید در الکترولیت:</strong> غلظت‌های ورودی و خروجی مدار تانک‌هاوس الکترووینینگ.</li>
                    </ul>

                    <h3 className="text-lg font-semibold text-cyan-500 pt-2 border-t border-gray-700">تفسیر نتایج</h3>
                    <ul className="list-disc list-inside space-y-2 pr-4">
                        <li><strong className="text-gray-100">انتقال خالص مس:</strong> یکی از مهم‌ترین پارامترهای اقتصادی که نشان می‌دهد به ازای هر درصد از استخراج‌کننده، چه مقدار مس به مدار الکترووینینگ منتقل می‌شود.</li>
                        <li><strong className="text-gray-100">بازیابی (Recovery):</strong> درصد مس استخراج شده از PLS و درصد مس استریپ شده از فاز آلی را نشان می‌دهد.</li>
                        <li><strong className="text-gray-100">نمودارهای McCabe-Thiele:</strong> این نمودارها به صورت بصری عملکرد مدار را نمایش می‌دهند. "منحنی تعادل" حداکثر انتقال ممکن را نشان می‌دهد و "خط عملیاتی" عملکرد واقعی مدار را. تعداد پله‌ها بین این دو خط، تعداد مراحل تئوری مورد نیاز برای رسیدن به جداسازی مطلوب را نشان می‌دهد.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};


// Helper component for input rows
const InputRow = ({ label, name, value, onChange }) => (
    <div className="grid grid-cols-2 items-center gap-x-2">
        <label htmlFor={name} className="text-sm text-gray-400">{label}:</label>
        <input
            type="number"
            id={name}
            name={name}
            value={value}
            onChange={onChange}
            className="w-full bg-gray-700 text-white p-1.5 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-right"
            step="0.01"
        />
    </div>
);

// Helper component for displaying summary results
const ResultsSummary = ({ results }) => (
    <div className="bg-gray-800 p-6 rounded-xl shadow-lg">
        <h2 className="text-xl font-semibold mb-4 text-cyan-400">خلاصه نتایج بهینه‌سازی</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
            <ResultCard label="درصد استخراج‌کننده (V%)" value={results.v_percent.toFixed(2)} unit="%" />
            <ResultCard label="انتقال خالص مس" value={results.stripping.netCu.toFixed(3)} unit="(g/L)/V%" />
            <ResultCard label="بازیابی استخراج" value={results.extraction.recovery.toFixed(2)} unit="%" />
            <ResultCard label="بازیابی استریپینگ" value={results.stripping.recovery.toFixed(2)} unit="%" />
            <ResultCard label="بارگذاری ماکزیمم (ML)" value={results.extraction.ml.toFixed(3)} unit="g/L" />
        </div>
    </div>
);

const ResultCard = ({ label, value, unit }) => (
    <div className="bg-gray-700/50 p-4 rounded-lg">
        <div className="text-2xl font-bold text-cyan-300">{value}</div>
        <div className="text-xs text-gray-400 mt-1">{label}</div>
        <div className="text-xs text-gray-500">{unit}</div>
    </div>
);

// Chart component
const ChartCard = ({ title, data }) => (
    <div className="bg-gray-800 p-4 rounded-xl shadow-lg h-96">
        <h3 className="text-lg font-semibold mb-4 text-center text-cyan-400">{title}</h3>
        <ResponsiveContainer width="100%" height="85%">
            <LineChart margin={{ top: 5, right: 20, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
                <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} stroke="#A0AEC0" tickFormatter={(tick) => tick.toFixed(2)}>
                     <Label value="غلظت مس در فاز آبی (g/L)" offset={-20} position="insideBottom" fill="#A0AEC0"/>
                </XAxis>
                <YAxis dataKey="y" type="number" domain={['dataMin', 'dataMax + 1']} stroke="#A0AEC0" tickFormatter={(tick) => tick.toFixed(2)}>
                    <Label value="غلظت مس در فاز آلی (g/L)" angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} fill="#A0AEC0"/>
                </YAxis>
                <Tooltip
                    contentStyle={{ backgroundColor: '#1A202C', border: '1px solid #4A5568' }}
                    labelStyle={{ color: '#E2E8F0' }}
                    formatter={(value, name) => [parseFloat(value).toFixed(3), name]}
                />
                <Legend wrapperStyle={{bottom: -5}}/>
                <Line type="monotone" data={data.equilibriumCurve} dataKey="y" name="منحنی تعادل" stroke="#2dd4bf" strokeWidth={2} dot={false} />
                <Line type="linear" data={data.operatingLine} dataKey="y" name="خط عملیاتی" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Scatter data={data.stages} fill="#facc15" name="مراحل"/>
            </LineChart>
        </ResponsiveContainer>
    </div>
);

// =================================================================
// CORE CALCULATION ENGINE
// This part contains all the mathematical formulas from the PDF
// =================================================================

const calculateAll = (i, V_percent, solve) => {
    try {
        // --- Helper function to solve cubic equations (Cardan's method from PDF) ---
        const solveCubic = (a, b, c, d) => {
            if (Math.abs(a) < 1e-9) return; // Not a cubic equation
            const p = c / a - (b * b) / (3 * a * a);
            const q = (2 * b * b * b) / (27 * a * a * a) - (b * c) / (3 * a * a) + d / a;
            
            const term1 = q / 2;
            const term2 = (q * q) / 4 + (p * p * p) / 27;

            if (term2 >= 0) {
                const sqrt_term2 = Math.sqrt(term2);
                const u = Math.cbrt(-term1 + sqrt_term2);
                const v = Math.cbrt(-term1 - sqrt_term2);
                return u + v - b / (3 * a);
            } else {
                const r = Math.sqrt(-(p*p*p)/27);
                const phi = Math.acos(-q / (2 * r));
                const root1 = 2 * Math.cbrt(r) * Math.cos(phi/3) - b/(3*a);
                return root1;
            }
        };
        
        // --- Extraction Calculation ---
        const extraction = (() => {
            const constants = {
                a_ex: i.plsAcid + 1.54 * i.plsCu,
                b_ex: -1.54,
                c_ex: 3.303 * V_percent,
                d_ex: -3.0842,
                e_ex: -25.698 * Math.pow(V_percent, -1.704),
                f_ex: 10.663 * Math.pow(V_percent, -0.608),
            };

            const getCu_or_from_Cu_aq = (Cu_aq) => {
                if (Cu_aq <= 0) return 0;
                const g_ex = Math.pow(constants.a_ex + constants.b_ex * Cu_aq, 2) / Cu_aq;
                const alpha_ex = (2 * constants.c_ex * constants.d_ex * constants.e_ex + Math.pow(constants.d_ex, 2) * constants.f_ex) / (Math.pow(constants.d_ex, 2) * constants.e_ex);
                const lambda_ex = (2 * constants.c_ex * constants.d_ex * constants.f_ex + Math.pow(constants.c_ex, 2) * constants.e_ex - g_ex) / (Math.pow(constants.d_ex, 2) * constants.e_ex);
                const epsilon_ex = (constants.f_ex * Math.pow(constants.c_ex, 2)) / (Math.pow(constants.d_ex, 2) * constants.e_ex);
                
                const Y = solveCubic(1, alpha_ex, lambda_ex, epsilon_ex);
                return Y;
            };
            
            const getCu_aq_from_Cu_or = (Cu_or) => {
                if (Cu_or <= 0) return 0;
                const h_ex = ((constants.e_ex * Cu_or + constants.f_ex) * Math.pow(constants.c_ex + constants.d_ex * Cu_or, 2)) / Cu_or;
                const a = Math.pow(constants.b_ex, 2);
                const b = 2 * constants.a_ex * constants.b_ex - h_ex;
                const c = Math.pow(constants.a_ex, 2);
                const discriminant = b*b - 4*a*c;
                if (discriminant < 0) return null;
                return (h_ex - 2*constants.a_ex*constants.b_ex - Math.sqrt(discriminant)) / (2*a);
            };

            const ml = getCu_or_from_Cu_aq(i.plsCu);
            const lo = ml * (i.percentageML / 100);

            // Stage 1
            const Y_out_E1 = lo;
            const X_in_E1 = i.plsCu;
            const stage1_solver_func = (X_out_guess) => {
                const Y_eq = getCu_or_from_Cu_aq(X_out_guess);
                const Y_in = Y_out_E1 - (X_in_E1 - X_out_guess) / i.o_a_ex;
                return (Y_out_E1 - Y_in) - (i.effE1 / 100) * (Y_eq - Y_in);
            };
            const X_out_E1 = solve(stage1_solver_func, X_in_E1 * 0.3, 1e-7, 100);
            const Y_in_E1 = Y_out_E1 - (X_in_E1 - X_out_E1) / i.o_a_ex;

            // Stage 2
            const Y_out_E2 = Y_in_E1;
            const X_in_E2 = X_out_E1;
             const stage2_solver_func = (X_out_guess) => {
                const Y_eq = getCu_or_from_Cu_aq(X_out_guess);
                const Y_in = Y_out_E2 - (X_in_E2 - X_out_guess) / i.o_a_ex;
                return (Y_out_E2 - Y_in) - (i.effE2 / 100) * (Y_eq - Y_in);
            };
            const X_out_E2 = solve(stage2_solver_func, X_in_E2 * 0.15, 1e-7, 100);
            const Y_in_E2 = Y_out_E2 - (X_in_E2 - X_out_E2) / i.o_a_ex;
            
            const so = Y_in_E2;
            const raff = X_out_E2;
            
            const recovery = (i.plsCu - raff) / i.plsCu * 100;
            const raffAcid = i.plsAcid + (i.plsCu - raff) * 1.54;
            
            const equilibriumCurve = Array.from({ length: 101 }, (_, k) => {
                const x = (i.plsCu / 100) * k;
                const y = getCu_or_from_Cu_aq(x);
                return { x, y };
            }).filter(p => p.y >= 0);

            const operatingLine = [
                { name: 'SO', x: raff, y: so },
                { name: 'LO', x: i.plsCu, y: lo }
            ];

            const stages = [
                { name: 'E1', x: X_out_E1, y: Y_out_E1 },
                { name: 'E2', x: X_out_E2, y: Y_out_E2 }
            ];

            const details = {
                raffAcid,
                stage1: {
                    A: { x: X_in_E1, y: Y_out_E1 },
                    B: { x: X_out_E1, y: Y_out_E1 },
                    C: { x: X_out_E1, y: Y_in_E1 },
                    D: { x: getCu_aq_from_Cu_or(getCu_or_from_Cu_aq(X_out_E1)), y: getCu_or_from_Cu_aq(X_out_E1) },
                    efficiency: i.effE1
                },
                stage2: {
                    A: { x: X_in_E2, y: Y_out_E2 },
                    B: { x: X_out_E2, y: Y_out_E2 },
                    C: { x: X_out_E2, y: Y_in_E2 },
                    D: { x: getCu_aq_from_Cu_or(getCu_or_from_Cu_aq(X_out_E2)), y: getCu_or_from_Cu_aq(X_out_E2) },
                    efficiency: i.effE2
                }
            };

            return { ml, lo, so, raff, recovery, mccabeThiele: { equilibriumCurve, operatingLine, stages }, details };
        })();
        
        // --- Stripping Calculation ---
        const stripping = (() => {
            const lo = extraction.lo;
            const so_ex = extraction.so;
            if (lo <= so_ex) throw new Error("خطای محاسباتی: غلظت LO باید بیشتر از SO باشد.");
            const o_a_st = (i.adCu - i.spCu) / (lo - so_ex);
            
            const constants = {
                a_st: i.spAcid + 1.54 * i.spCu,
                b_st: -1.54,
                c_st: 3.303 * V_percent,
                d_st: -3.0842,
                e_st: (5.11e-3 * V_percent) - 0.194,
                f_st: 12.81 * Math.pow(V_percent, -0.901),
            };

            const getCu_or_from_Cu_aq_stripping = (Cu_aq) => {
                if (Cu_aq <= 0) return 0;
                const g_st = Math.pow(constants.a_st + constants.b_st * Cu_aq, 2) / Cu_aq;
                const alpha_st = (2 * constants.c_st * constants.d_st * constants.e_st + Math.pow(constants.d_st, 2) * constants.f_st) / (Math.pow(constants.d_st, 2) * constants.e_st);
                const lambda_st = (2 * constants.c_st * constants.d_st * constants.f_st + Math.pow(constants.c_st, 2) * constants.e_st - g_st) / (Math.pow(constants.d_st, 2) * constants.e_st);
                const epsilon_st = (constants.f_st * Math.pow(constants.c_st, 2)) / (Math.pow(constants.d_st, 2) * constants.e_st);
                
                const Y = solveCubic(1, alpha_st, lambda_st, epsilon_st);
                return Y;
            };
            
            // Stage 1
            const Y_in_S1 = lo;
            const X_out_S1 = i.adCu;
            const Y_eq_S1 = getCu_or_from_Cu_aq_stripping(X_out_S1);
            const Y_out_S1 = Y_in_S1 - (i.effS1/100)*(Y_in_S1 - Y_eq_S1);
            const X_in_S1 = X_out_S1 - o_a_st * (Y_in_S1 - Y_out_S1);

            // Stage 2
            const Y_in_S2 = Y_out_S1;
            const X_out_S2 = X_in_S1;
            const Y_eq_S2 = getCu_or_from_Cu_aq_stripping(X_out_S2);
            const so = Y_in_S2 - (i.effS2/100)*(Y_in_S2 - Y_eq_S2);
            
            const recovery = (lo - so) / lo * 100;
            const netCu = (lo - so) / V_percent;
            
            const equilibriumCurve = Array.from({ length: 101 }, (_, k) => {
                const x = i.spCu + ((i.adCu - i.spCu + 5) / 100) * k;
                const y = getCu_or_from_Cu_aq_stripping(x);
                return { x, y };
            }).filter(p => p.y >= 0);

            const operatingLine = [
                { name: 'SO', x: i.spCu, y: so },
                { name: 'LO', x: i.adCu, y: lo }
            ];

            const stages = [
                { name: 'S1', x: X_out_S1, y: Y_in_S1 },
                { name: 'S2', x: X_out_S2, y: Y_in_S2 }
            ];

            const details = {
                o_a_st,
                stage1: {
                    A: { x: X_out_S1, y: Y_in_S1 },
                    B: { x: X_out_S1, y: Y_out_S1 },
                    C: { x: X_in_S1, y: Y_out_S1 },
                    D: { x: X_out_S1, y: Y_eq_S1 },
                    efficiency: i.effS1
                },
                stage2: {
                    A: { x: X_out_S2, y: Y_in_S2 },
                    B: { x: X_out_S2, y: Y_in_S2 - (i.effS2/100)*(Y_in_S2 - Y_eq_S2) },
                    C: { x: i.spCu, y: so },
                    D: { x: X_out_S2, y: Y_eq_S2 },
                    efficiency: i.effS2
                }
            };

            return { so, recovery, netCu, mccabeThiele: { equilibriumCurve, operatingLine, stages }, details };
        })();

        return {
            v_percent: V_percent,
            extraction,
            stripping,
            constraints: {
                so_consistency: extraction.so - stripping.so
            }
        };
    } catch (e) {
        console.error("Calculation failed:", e);
        return null; // Indicate failure
    }
};

export default App;
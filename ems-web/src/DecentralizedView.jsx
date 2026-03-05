import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Zap, Battery, BatteryCharging, ArrowRightLeft, Sun, Building,
    IndianRupee, MapPin, Activity, BarChart3, Network, Leaf, Play, RefreshCw,
    Wind, Flame, Thermometer, Home, Clock, TrendingDown, FileText, Settings, X, Info,
    Calculator, BookOpen, ChevronDown, ChevronUp
} from 'lucide-react';
import {
    AreaChart, Area, BarChart as RBarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts';

const API_BASE = 'http://127.0.0.1:8001';

// ============================
// FIX: CITIES_META defined at module level before any component uses it
// ============================
const CITIES_META = {
    delhi: { name: 'Delhi', color: '#f59e0b' },
    mumbai: { name: 'Mumbai', color: '#3b82f6' },
    chennai: { name: 'Chennai', color: '#ef4444' },
    kolkata: { name: 'Kolkata', color: '#10b981' },
    jaipur: { name: 'Jaipur', color: '#8b5cf6' },
};

// City positions on SVG map
const CITY_MAP_POS = {
    delhi: { x: 200, y: 120, color: '#f59e0b' },
    jaipur: { x: 160, y: 165, color: '#8b5cf6' },
    mumbai: { x: 135, y: 270, color: '#3b82f6' },
    kolkata: { x: 330, y: 210, color: '#10b981' },
    chennai: { x: 230, y: 360, color: '#ef4444' },
};

// India outline path (simplified)
const INDIA_PATH = `M 180 60 L 220 55 L 250 70 L 280 65 L 310 80 L 340 90 L 360 120
  L 370 160 L 365 190 L 350 210 L 340 240 L 330 260 L 310 280
  L 290 300 L 270 330 L 250 360 L 240 380 L 230 395 L 220 390
  L 210 375 L 195 350 L 175 330 L 155 310 L 140 290 L 125 260
  L 120 240 L 115 210 L 120 180 L 130 150 L 140 120 L 155 90
  L 170 70 Z`;

const CHART_TOOLTIP_STYLE = {
    contentStyle: {
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        fontSize: '0.8rem',
        color: '#1e293b',
        boxShadow: '0 4px 16px rgba(0,0,0,0.1)'
    },
    labelStyle: { color: '#64748b', fontWeight: 600 }
};

// ============================
// CALCULATION EXPLAINER PANEL
// ============================
function CalcExplainerPanel({ optSettings }) {
    const [open, setOpen] = useState(false);

    const ef = optSettings?.grid_emission_factor ?? 0.5;
    const ct = optSettings?.carbon_tax ?? 2.0;
    const deg = optSettings?.deg_cost_per_kwh ?? 0.5;
    const pdc = optSettings?.peak_demand_charge ?? 150.0;
    const etaCh = optSettings?.battery_eta_ch ?? 0.95;
    const etaDis = optSettings?.battery_eta_dis ?? 0.95;

    return (
        <div style={{
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
            border: '1px solid #bae6fd',
            borderRadius: '1rem',
            marginBottom: '1.5rem',
            overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(14,165,233,0.08)'
        }}>
            {/* Header — always visible */}
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '0.9rem 1.25rem',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#0369a1'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Calculator size={20} color="#0284c7" />
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0c4a6e' }}>
                        How Cost &amp; Carbon Emission Are Calculated
                    </span>
                    <span style={{
                        background: '#0284c7', color: 'white', fontSize: '0.65rem',
                        padding: '2px 8px', borderRadius: '1rem', fontWeight: 700, letterSpacing: '0.04em'
                    }}>LIVE PARAMS</span>
                </div>
                {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {open && (
                <div style={{ padding: '0 1.25rem 1.25rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>

                        {/* === COST CALCULATION === */}
                        <div style={{
                            background: 'white', borderRadius: '0.75rem',
                            padding: '1.1rem', border: '1px solid #e0f2fe',
                            boxShadow: '0 1px 6px rgba(14,165,233,0.07)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.9rem' }}>
                                <IndianRupee size={18} color="#d97706" />
                                <span style={{ fontWeight: 700, color: '#92400e', fontSize: '0.95rem' }}>
                                    Total Cost Formula
                                </span>
                            </div>

                            {/* Formula block */}
                            <div style={{
                                background: '#fefce8', border: '1px solid #fde68a',
                                borderRadius: '0.5rem', padding: '0.75rem',
                                fontFamily: 'monospace', fontSize: '0.78rem',
                                color: '#78350f', lineHeight: 1.7, marginBottom: '0.9rem'
                            }}>
                                <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#92400e' }}>
                                    Cost = E_cost + Deg + Demand + Carbon
                                </div>
                                <div>E_cost &nbsp;= P_imp × ImpPrice − P_exp × ExpPrice</div>
                                <div>Deg &nbsp;&nbsp;&nbsp;&nbsp;= P_dis × <strong>{deg} ₹/kWh</strong></div>
                                <div>Demand &nbsp;= max(P_imp) × <strong>{pdc} ₹/kW</strong></div>
                                <div>Carbon &nbsp;= P_imp × {ef} × <strong>{ct} ₹/kg</strong></div>
                            </div>

                            {/* Term explanations */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                {[
                                    { label: 'Energy Cost', color: '#f59e0b', desc: 'Revenue from exporting minus cost of importing grid power. Import prices vary by hour (₹4–₹13/kWh), export prices are 50% of import.' },
                                    { label: 'Degradation', color: '#f87171', desc: `Battery wear cost per kWh discharged (currently ₹${deg}/kWh). Incentivises not over-cycling the battery.` },
                                    { label: 'Demand Charge', color: '#a78bfa', desc: `Peak import demand fee: highest import kW in the period × ₹${pdc}. Encourages flattening the import curve.` },
                                    { label: 'Carbon Tax', color: '#34d399', desc: `Grid import × emission factor (${ef} kg CO₂/kWh) × carbon tax (₹${ct}/kg). Penalises fossil-heavy grid draws.` },
                                ].map(t => (
                                    <div key={t.label} style={{
                                        display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                                        padding: '0.4rem 0.5rem', background: '#fafafa',
                                        borderRadius: '0.4rem', borderLeft: `3px solid ${t.color}`
                                    }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: t.color, minWidth: 90, paddingTop: 1 }}>
                                            {t.label}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>{t.desc}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Battery efficiency note */}
                            <div style={{
                                marginTop: '0.75rem', padding: '0.5rem 0.75rem',
                                background: '#f0fdf4', borderRadius: '0.4rem',
                                border: '1px solid #bbf7d0', fontSize: '0.75rem', color: '#166534'
                            }}>
                                <strong>Battery efficiency:</strong>&nbsp;
                                Charge η = {(etaCh * 100).toFixed(0)}% &nbsp;|&nbsp; Discharge η = {(etaDis * 100).toFixed(0)}%
                                &nbsp;— losses are implicit in the SOC trajectory constraint.
                            </div>
                        </div>

                        {/* === CARBON CALCULATION === */}
                        <div style={{
                            background: 'white', borderRadius: '0.75rem',
                            padding: '1.1rem', border: '1px solid #d1fae5',
                            boxShadow: '0 1px 6px rgba(16,185,129,0.07)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.9rem' }}>
                                <Leaf size={18} color="#059669" />
                                <span style={{ fontWeight: 700, color: '#064e3b', fontSize: '0.95rem' }}>
                                    Carbon Emission Formula
                                </span>
                            </div>

                            <div style={{
                                background: '#f0fdf4', border: '1px solid #bbf7d0',
                                borderRadius: '0.5rem', padding: '0.75rem',
                                fontFamily: 'monospace', fontSize: '0.78rem',
                                color: '#065f46', lineHeight: 1.7, marginBottom: '0.9rem'
                            }}>
                                <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#064e3b' }}>
                                    Carbon (kg CO₂) = P_imp × EF
                                </div>
                                <div>P_imp = Grid import power (kW)</div>
                                <div>EF &nbsp;&nbsp;&nbsp;= Grid emission factor</div>
                                <div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;= <strong>{ef} kg CO₂/kWh</strong> (current)</div>
                                <div style={{ marginTop: '0.4rem', color: '#047857' }}>
                                    ∴ Carbon = P_imp × {ef} kg per kWh imported
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                {[
                                    { label: 'Why only imports?', color: '#10b981', desc: 'Local PV, wind, and thermal generation is treated as zero-emission. Only drawing from the external grid contributes to carbon accounting.' },
                                    { label: 'Emission factor', color: '#6ee7b7', desc: `The Indian grid average is ~0.5 kg CO₂/kWh (CEA data). You can tune this in Settings. Lower = cleaner grid mix.` },
                                    { label: 'MPC advantage', color: '#34d399', desc: 'MPC dispatch prefers battery discharge over grid import during high-price / high-emission hours, reducing both cost and carbon simultaneously.' },
                                    { label: 'P2P trading', color: '#a7f3d0', desc: 'Surplus city energy sold peer-to-peer displaces grid imports in deficit cities, cutting network-wide carbon without new generation.' },
                                ].map(t => (
                                    <div key={t.label} style={{
                                        display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                                        padding: '0.4rem 0.5rem', background: '#fafafa',
                                        borderRadius: '0.4rem', borderLeft: `3px solid ${t.color}`
                                    }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: t.color, minWidth: 110, paddingTop: 1 }}>
                                            {t.label}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: '#475569', lineHeight: 1.5 }}>{t.desc}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Numerical example */}
                            <div style={{
                                marginTop: '0.75rem', padding: '0.6rem 0.75rem',
                                background: '#ecfdf5', borderRadius: '0.4rem',
                                border: '1px solid #a7f3d0', fontSize: '0.75rem', color: '#065f46'
                            }}>
                                <strong>Example:</strong> Importing 10 kW for 1 h &rarr;&nbsp;
                                <strong>{(10 * ef).toFixed(1)} kg CO₂</strong> &amp;&nbsp;
                                carbon cost <strong>₹{(10 * ef * ct).toFixed(1)}</strong>
                            </div>
                        </div>
                    </div>

                    {/* IAROA vs MPC explainer */}
                    <div style={{
                        marginTop: '1rem', background: 'white', borderRadius: '0.75rem',
                        padding: '1rem 1.25rem', border: '1px solid #e0e7ff',
                        boxShadow: '0 1px 6px rgba(99,102,241,0.07)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.7rem' }}>
                            <BookOpen size={16} color="#6366f1" />
                            <span style={{ fontWeight: 700, color: '#312e81', fontSize: '0.9rem' }}>
                                Algorithm Roles in Cost Minimisation
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            {[
                                {
                                    name: 'IAROA (Improved Artificial Rabbits Optimisation)',
                                    color: '#d97706',
                                    bg: '#fffbeb',
                                    border: '#fde68a',
                                    points: [
                                        'Metaheuristic population-based search over the full 24 h horizon',
                                        'Optimises battery charge/discharge schedule + curtailment jointly',
                                        'Minimises total cost objective including all four terms above',
                                        'Runs independently per city (decentralised, no data sharing)',
                                    ]
                                },
                                {
                                    name: 'MPC (Model Predictive Control) — real-time correction',
                                    color: '#059669',
                                    bg: '#f0fdf4',
                                    border: '#bbf7d0',
                                    points: [
                                        'Single-step heuristic dispatch applied on top of IAROA plan',
                                        'Discharges battery when import price > average (avoid peak tariff)',
                                        'Charges battery from surplus PV when price is cheap (< 85% avg)',
                                        'Reduces grid import at high-emission peak hours → less carbon',
                                    ]
                                },
                            ].map(a => (
                                <div key={a.name} style={{
                                    background: a.bg, borderRadius: '0.6rem',
                                    padding: '0.75rem', border: `1px solid ${a.border}`
                                }}>
                                    <div style={{ fontWeight: 700, color: a.color, fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                                        {a.name}
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#374151', fontSize: '0.75rem', lineHeight: 1.7 }}>
                                        {a.points.map((p, i) => <li key={i}>{p}</li>)}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


// ============================
// MAIN COMPONENT
// ============================
function DecentralizedView() {
    const [cities, setCities] = useState([]);
    const [commLinks, setCommLinks] = useState([]);
    const [selectedCity, setSelectedCity] = useState(null);
    const [optimizing, setOptimizing] = useState(false);
    const [optResults, setOptResults] = useState(null);
    const [animPhase, setAnimPhase] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [optSettings, setOptSettings] = useState({
        deg_cost_per_kwh: 0.50,
        peak_demand_charge: 150.0,
        grid_emission_factor: 0.5,
        carbon_tax: 2.0,
        battery_eta_ch: 0.95,
        battery_eta_dis: 0.95,
    });
    const [calcLogic, setCalcLogic] = useState(null);
    const [savingSettings, setSavingSettings] = useState(false);

    // Simulation states
    const [simulating, setSimulating] = useState(false);
    const [simResults, setSimResults] = useState(null);
    const [simHour, setSimHour] = useState(null);
    const [selectedDate, setSelectedDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 2);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    });
    const [playbackSpeed, setPlaybackSpeed] = useState(200);

    // Managed simulation ticker
    useEffect(() => {
        let timer;
        if (simulating && simHour !== null) {
            timer = setInterval(() => {
                setSimHour(prev => {
                    if (prev >= 23) { setSimulating(false); return prev; }
                    return prev + 1;
                });
            }, playbackSpeed);
        }
        return () => clearInterval(timer);
    }, [simulating, simHour, playbackSpeed]);

    // Derived display states: simulation overrides live data
    const displayCities = useMemo(() => {
        if (simHour !== null && simResults && simResults[simHour]) {
            const hr = simResults[simHour];
            return cities.map(c => {
                const s = hr.city_opt_results[c.id];
                if (!s) return c;
                const surplus = Math.max(0, s.tot_gen_now - s.load_now);
                const deficit = Math.max(0, s.load_now - s.tot_gen_now);
                return {
                    ...c,
                    pv_now_kw: s.pv_now,
                    wind_now_kw: s.wind_now,
                    thermal_now_kw: s.thermal_now,
                    tot_gen_kw: s.tot_gen_now,
                    load_now_kw: s.load_now,
                    soc_pct: s.soc_pct,
                    soc_kwh: s.soc_kwh,
                    net_power_kw: Math.round((s.tot_gen_now - s.load_now) * 100) / 100,
                    status: surplus > 0 ? 'surplus' : (deficit > 1 ? 'deficit' : 'balanced'),
                    current_temp_c: s.current_temp_c ?? c.current_temp_c,
                    current_wind_mps: s.current_wind_mps ?? c.current_wind_mps,
                };
            });
        }
        return cities;
    }, [cities, simHour, simResults]);

    const displayOptResults = useMemo(() => {
        if (simHour !== null && simResults && simResults[simHour]) {
            const hr = simResults[simHour];
            const ioraCost = hr.iora_only.total_cost_inr;
            const mpcCost = hr.iora_mpc.total_cost_inr;
            const costDiff = ioraCost - mpcCost;
            return {
                iora_only: hr.iora_only,
                iora_mpc: hr.iora_mpc,
                p2p_trades: hr.p2p_trades_mpc,
                comparison: {
                    cost_saving_inr: costDiff,
                    carbon_saving_kg: hr.iora_only.total_carbon_kg - hr.iora_mpc.total_carbon_kg,
                    mpc_overhead_ms: 0,
                    verdict: mpcCost <= ioraCost ? 'IAROA+MPC' : 'IAROA-Only',
                    verdict_reason: mpcCost <= ioraCost
                        ? `IAROA+MPC saves ₹${Math.abs(costDiff).toFixed(1)}`
                        : `IAROA-Only cheaper by ₹${Math.abs(costDiff).toFixed(1)}`
                }
            };
        }
        return optResults;
    }, [optResults, simHour, simResults]);

    // Animation loop
    useEffect(() => {
        const timer = setInterval(() => setAnimPhase(p => (p + 1) % 360), 50);
        return () => clearInterval(timer);
    }, []);

    const fetchCities = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/cities?start_date=${selectedDate}&end_date=${endDate}`);
            const data = await res.json();
            setCities(data.cities);
            setCommLinks(data.communication_links);
        } catch (e) {
            console.warn('Failed to fetch cities:', e);
        }
    }, [selectedDate, endDate]);

    const fetchSettings = useCallback(async () => {
        try {
            const [sRes, lRes] = await Promise.all([
                fetch(`${API_BASE}/optimization-settings`),
                fetch(`${API_BASE}/calculation-logic`)
            ]);
            if (sRes.ok) setOptSettings(await sRes.json());
            if (lRes.ok) setCalcLogic(await lRes.json());
        } catch (e) {
            console.warn('Failed to fetch settings:', e);
        }
    }, []);

    useEffect(() => { fetchSettings(); }, [fetchSettings]);

    useEffect(() => {
        fetchCities();
        const iv = setInterval(fetchCities, 15000);
        return () => clearInterval(iv);
    }, [fetchCities]);

    const runOptimization = async () => {
        setOptimizing(true);
        setSimHour(null);
        setSimulating(false);
        try {
            const res = await fetch(
                `${API_BASE}/optimize-decentralized?start_date=${selectedDate}&end_date=${endDate}`,
                { method: 'POST' }
            );
            const data = await res.json();
            setOptResults(data);
            fetchCities();
        } catch (e) {
            console.error('Optimization failed:', e);
        } finally {
            setOptimizing(false);
        }
    };

    const run24hSimulation = async () => {
        setOptimizing(true);
        try {
            const res = await fetch(
                `${API_BASE}/simulate-24h?start_date=${selectedDate}&end_date=${endDate}`,
                { method: 'POST' }
            );
            const data = await res.json();
            setSimResults(data.simulation);
            setSimHour(0);
            setSimulating(true);
        } catch (e) {
            console.error('Simulation failed:', e);
            setSimulating(false);
            setSimHour(null);
        } finally {
            setOptimizing(false);
        }
    };

    const resetSimulation = () => {
        setSimulating(false);
        setSimHour(null);
        setSimResults(null);
        setOptResults(null);
    };

    const updateGlobalSettings = async (newSettings) => {
        setSavingSettings(true);
        try {
            const res = await fetch(`${API_BASE}/optimization-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings)
            });
            if (res.ok) {
                const data = await res.json();
                setOptSettings(data.settings);
                await fetchSettings();
                setShowSettings(false);
            }
        } catch (e) {
            console.error('Failed to update settings:', e);
        } finally {
            setSavingSettings(false);
        }
    };

    const getStatusColor = (status) => {
        if (status === 'surplus') return '#10b981';
        if (status === 'deficit') return '#ef4444';
        return '#3b82f6';
    };

    return (
        <div className="decent-container">
            {/* ================================
                FIX: Settings Modal at TOP LEVEL
                (outside comparison-section)
            ================================ */}
            {showSettings && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)',
                    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{
                        width: '90%', maxWidth: '640px', padding: '2rem',
                        position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
                        backgroundColor: 'white', borderRadius: '1rem'
                    }}>
                        <button onClick={() => setShowSettings(false)} style={{
                            position: 'absolute', top: '1rem', right: '1rem',
                            background: 'none', border: 'none', cursor: 'pointer', color: '#64748b'
                        }}>
                            <X size={24} />
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <Settings size={24} color="#3b82f6" />
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>
                                Optimization Global Parameters
                            </h3>
                        </div>

                        {calcLogic && (
                            <div style={{
                                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                                padding: '1rem', marginBottom: '1.5rem', fontSize: '0.85rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                                    <Info size={16} color="#3b82f6" /> Calculation Logic
                                </div>
                                <div style={{ color: '#64748b', whiteSpace: 'pre-wrap' }}>
                                    <strong>{calcLogic.cost_calculation.formula}</strong>{"\n"}
                                    • Energy: {calcLogic.cost_calculation.energy_cost}{"\n"}
                                    • Degradation: {calcLogic.cost_calculation.degradation_cost}{"\n"}
                                    • Demand: {calcLogic.cost_calculation.demand_charge}{"\n"}
                                    • Carbon: {calcLogic.cost_calculation.carbon_cost}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            {[
                                { key: 'deg_cost_per_kwh', label: 'Degradation (₹/kWh)', step: 0.1 },
                                { key: 'peak_demand_charge', label: 'Demand Chg (₹/kW)', step: 10 },
                                { key: 'grid_emission_factor', label: 'Grid Emission (kg CO₂/kWh)', step: 0.05 },
                                { key: 'carbon_tax', label: 'Carbon Tax (₹/kg CO₂)', step: 0.5 },
                                { key: 'battery_eta_ch', label: 'Charge Efficiency (0–1)', step: 0.01 },
                                { key: 'battery_eta_dis', label: 'Discharge Efficiency (0–1)', step: 0.01 },
                            ].map(field => (
                                <div key={field.key}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>
                                        {field.label}
                                    </label>
                                    <input
                                        type="number" step={field.step}
                                        value={optSettings[field.key]}
                                        onChange={(e) => setOptSettings({ ...optSettings, [field.key]: parseFloat(e.target.value) })}
                                        style={{
                                            width: '100%', padding: '0.6rem', borderRadius: '0.4rem',
                                            border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                            <button onClick={() => updateGlobalSettings(optSettings)} disabled={savingSettings}
                                style={{
                                    flex: 1, padding: '0.75rem', borderRadius: '0.5rem', border: 'none',
                                    background: '#3b82f6', color: 'white', fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                                }}>
                                {savingSettings ? <RefreshCw size={18} /> : <Play size={18} />}
                                Save &amp; Apply Globally
                            </button>
                            <button onClick={() => setShowSettings(false)} style={{
                                padding: '0.75rem 1.5rem', borderRadius: '0.5rem',
                                border: '1px solid #e2e8f0', background: 'white',
                                color: '#64748b', fontWeight: 600, cursor: 'pointer'
                            }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="decent-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Network size={28} color="#60a5fa" />
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' }}>
                            Decentralized 5-City Microgrid Network
                        </h2>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Peer-to-peer energy trading with IAROA &amp; MPC optimization
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    {simResults && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '1rem',
                            background: '#eff6ff', padding: '0.4rem 1rem',
                            borderRadius: '2rem', border: '1px solid #bfdbfe'
                        }}>
                            <button onClick={() => setSimulating(!simulating)} style={{
                                background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 0, display: 'flex'
                            }}>
                                {simulating ? <Activity size={20} /> : <Play size={20} />}
                            </button>
                            <div style={{ display: 'flex', flexDirection: 'column', width: '120px' }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1e40af', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>HOUR {simHour?.toString().padStart(2, '0')}:00</span>
                                    <span>23:00</span>
                                </div>
                                <input
                                    type="range" min="0" max="23" step="1"
                                    value={simHour || 0}
                                    onChange={(e) => { setSimHour(parseInt(e.target.value)); setSimulating(false); }}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <button onClick={resetSimulation} title="Clear Simulation" style={{
                                background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0, display: 'flex'
                            }}>
                                <RefreshCw size={18} />
                            </button>
                        </div>
                    )}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white',
                        padding: '0.25rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0'
                    }}>
                        <Clock size={16} color="#64748b" />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>START</span>
                            <input type="date" value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                style={{ border: 'none', outline: 'none', fontSize: '0.9rem', color: '#1e293b', fontWeight: 500 }} />
                        </div>
                        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 0.5rem' }} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>END</span>
                            <input type="date" value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                style={{ border: 'none', outline: 'none', fontSize: '0.9rem', color: '#1e293b', fontWeight: 500 }} />
                        </div>
                    </div>
                    <button className="btn-optimize-decent" onClick={runOptimization} disabled={optimizing || simulating}>
                        {optimizing && simHour === null
                            ? <><RefreshCw size={16} /> Running...</>
                            : <><Zap size={16} /> Live Optimization</>}
                    </button>
                    <button className="btn-optimize-decent" onClick={run24hSimulation} disabled={optimizing || simulating}
                        style={{ background: 'linear-gradient(45deg, #8b5cf6, #ec4899)' }}>
                        {optimizing && simHour !== null
                            ? <><RefreshCw size={16} /> Fetching...</>
                            : <><Activity size={16} /> Run 24h Simulation</>}
                    </button>
                    <button onClick={() => setShowSettings(true)} style={{
                        background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                        padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', color: '#64748b'
                    }}>
                        <Settings size={20} />
                    </button>
                </div>
            </div>

            {/* Main Grid: Map + Details */}
            <div className="decent-main-grid">
                {/* === SVG MAP === */}
                <div className="map-container glass-panel">
                    <div className="panel-title" style={{ marginBottom: '0.5rem' }}>
                        <MapPin size={20} color="#f59e0b" /> Network Topology Map
                    </div>
                    <svg viewBox="50 30 380 400" className="india-map-svg">
                        <defs>
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <filter id="glow-strong">
                                <feGaussianBlur stdDeviation="6" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <linearGradient id="link-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                                <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.7" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
                            </linearGradient>
                            <linearGradient id="trade-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                                <stop offset="50%" stopColor="#34d399" stopOpacity="0.9" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.4" />
                            </linearGradient>
                        </defs>

                        <path d={INDIA_PATH} fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.4)"
                            strokeWidth="1.5" strokeLinejoin="round" />

                        {commLinks.map((link, i) => {
                            const from = CITY_MAP_POS[link.from];
                            const to = CITY_MAP_POS[link.to];
                            if (!from || !to) return null;
                            const isTrade = displayOptResults?.p2p_trades?.some(
                                t => (t.from === link.from && t.to === link.to) ||
                                    (t.from === link.to && t.to === link.from)
                            );
                            const distanceKm = Math.round(
                                Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2)) * 4.8
                            );
                            const midX = (from.x + to.x) / 2;
                            const midY = (from.y + to.y) / 2;
                            return (
                                <g key={`link-${i}`}>
                                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                                        stroke={isTrade ? 'url(#trade-grad)' : 'url(#link-grad)'}
                                        strokeWidth={isTrade ? 2.5 : 1.2}
                                        strokeDasharray={isTrade ? '8 4' : '4 6'}
                                        strokeDashoffset={animPhase * (isTrade ? 2 : 1)}
                                        opacity={0.8} />
                                    {isTrade && (
                                        <circle r="3" fill="#34d399" filter="url(#glow)">
                                            <animateMotion dur="2s" repeatCount="indefinite"
                                                path={`M${from.x},${from.y} L${to.x},${to.y}`} />
                                        </circle>
                                    )}
                                    <text x={midX} y={midY - 4} fill="#475569" fontSize="7" textAnchor="middle" opacity="0.9">
                                        {distanceKm}km
                                    </text>
                                </g>
                            );
                        })}

                        {displayCities.map((city) => {
                            const pos = CITY_MAP_POS[city.id];
                            if (!pos) return null;
                            const isSelected = selectedCity === city.id;
                            const statusColor = getStatusColor(city.status);
                            const pulseR = 18 + 3 * Math.sin((animPhase + city.id.charCodeAt(0) * 30) * Math.PI / 180);
                            return (
                                <g key={city.id} onClick={() => setSelectedCity(isSelected ? null : city.id)}
                                    style={{ cursor: 'pointer' }}>
                                    <circle cx={pos.x} cy={pos.y} r={pulseR}
                                        fill="none" stroke={statusColor} strokeWidth="1" opacity="0.3" />
                                    <circle cx={pos.x} cy={pos.y} r="14"
                                        fill={statusColor} opacity="0.15" filter="url(#glow-strong)" />
                                    <circle cx={pos.x} cy={pos.y} r={isSelected ? 13 : 10}
                                        fill={`${statusColor}33`} stroke={statusColor} strokeWidth={isSelected ? 2.5 : 1.5}
                                        filter="url(#glow)" />
                                    <circle cx={pos.x} cy={pos.y} r="4" fill={statusColor} />
                                    <text x={pos.x} y={pos.y - 22} textAnchor="middle"
                                        fill="#1e293b" fontSize="11" fontWeight="600">
                                        {city.name}
                                    </text>
                                    <text x={pos.x} y={pos.y + 28} textAnchor="middle"
                                        fill={statusColor} fontSize="9" fontWeight="500">
                                        {city.net_power_kw > 0 ? '+' : ''}{city.net_power_kw} kW
                                    </text>
                                </g>
                            );
                        })}

                        {displayOptResults?.p2p_trades?.map((trade, i) => {
                            const from = CITY_MAP_POS[trade.from];
                            const to = CITY_MAP_POS[trade.to];
                            if (!from || !to) return null;
                            return (
                                <text key={`trade-label-${i}`}
                                    x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8}
                                    textAnchor="middle" fill="#059669" fontSize="8" fontWeight="700">
                                    ⚡{trade.amount_kw} kW
                                </text>
                            );
                        })}
                    </svg>

                    <div className="map-legend">
                        <span><span className="legend-dot" style={{ background: '#10b981' }} /> Surplus</span>
                        <span><span className="legend-dot" style={{ background: '#ef4444' }} /> Deficit</span>
                        <span><span className="legend-dot" style={{ background: '#3b82f6' }} /> Balanced</span>
                        <span><span className="legend-line trade" /> Energy Trade</span>
                        <span><span className="legend-line comm" /> Comm Link</span>
                    </div>
                </div>

                {/* === CITY DETAIL PANEL === */}
                <div className="city-detail-panel glass-panel">
                    <div className="panel-title">
                        <Building size={20} color="#60a5fa" />
                        {selectedCity
                            ? `${CITIES_META[selectedCity]?.name || selectedCity} Microgrid`
                            : 'City Details'}
                    </div>

                    {selectedCity && displayCities.find(c => c.id === selectedCity) ? (() => {
                        const city = displayCities.find(c => c.id === selectedCity);
                        const ioraData = displayOptResults?.iora_only?.per_city?.[selectedCity];
                        const mpcData = displayOptResults?.iora_mpc?.per_city?.[selectedCity];
                        return (
                            <div className="city-detail-content">
                                <div className="city-status-badge" style={{
                                    borderColor: getStatusColor(city.status),
                                    background: `${getStatusColor(city.status)}15`
                                }}>
                                    <span style={{ color: getStatusColor(city.status), fontWeight: 600, fontSize: '0.9rem' }}>
                                        {city.status === 'surplus' ? '☀️ Energy Surplus'
                                            : city.status === 'deficit' ? '⚡ Energy Deficit' : '⚖️ Balanced'}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <Thermometer size={14} color="#f87171" style={{ marginRight: '-4px' }} /> {city.current_temp_c}°C
                                        <Wind size={14} color="#94a3b8" style={{ marginLeft: '4px', marginRight: '-4px' }} /> {city.current_wind_mps} m/s
                                    </span>
                                </div>

                                <div className="city-metrics-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                                    <div className="city-metric">
                                        <Sun size={16} color="#facc15" />
                                        <div>
                                            <div className="metric-val" style={{ color: '#facc15' }}>{city.pv_now_kw} kW</div>
                                            <div className="metric-label">Solar PV</div>
                                        </div>
                                    </div>
                                    <div className="city-metric">
                                        <Wind size={16} color="#93c5fd" />
                                        <div>
                                            <div className="metric-val" style={{ color: '#93c5fd' }}>{city.wind_now_kw} kW</div>
                                            <div className="metric-label">Wind</div>
                                        </div>
                                    </div>
                                    <div className="city-metric">
                                        <Flame size={16} color="#f87171" />
                                        <div>
                                            <div className="metric-val" style={{ color: '#f87171' }}>{city.thermal_now_kw} kW</div>
                                            <div className="metric-label">Thermal</div>
                                        </div>
                                    </div>
                                    <div className="city-metric">
                                        <Building size={16} color="#3b82f6" />
                                        <div>
                                            <div className="metric-val" style={{ color: '#3b82f6' }}>{city.load_now_kw} kW</div>
                                            <div className="metric-label" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                <Home size={10} /> {city.houses_count}
                                                <Building size={10} style={{ marginLeft: '2px' }} /> {city.buildings_count}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="city-metric">
                                        <Battery size={16} color={city.soc_pct > 50 ? '#10b981' : '#f59e0b'} />
                                        <div>
                                            <div className="metric-val" style={{ color: city.soc_pct > 50 ? '#10b981' : '#f59e0b' }}>
                                                {city.soc_pct}%
                                            </div>
                                            <div className="metric-label">SOC ({city.soc_kwh?.toFixed(1)})</div>
                                        </div>
                                    </div>
                                    <div className="city-metric">
                                        <Activity size={16} color={city.net_power_kw >= 0 ? '#10b981' : '#ef4444'} />
                                        <div>
                                            <div className="metric-val" style={{ color: city.net_power_kw >= 0 ? '#10b981' : '#ef4444' }}>
                                                {city.net_power_kw > 0 ? '+' : ''}{city.net_power_kw} kW
                                            </div>
                                            <div className="metric-label">Net Power</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="city-soc-bar">
                                    <div className="soc-bar-track">
                                        <div className="soc-bar-fill" style={{
                                            width: `${city.soc_pct}%`,
                                            background: city.soc_pct > 60
                                                ? 'linear-gradient(90deg, #10b981, #34d399)'
                                                : city.soc_pct > 30
                                                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                                                    : 'linear-gradient(90deg, #ef4444, #f87171)'
                                        }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                        <span>0%</span>
                                        <span>Battery Capacity: {city.bat_cap_kwh} kWh</span>
                                        <span>100%</span>
                                    </div>
                                </div>

                                {ioraData && mpcData && (
                                    <div className="city-opt-compare">
                                        <div className="panel-subtitle" style={{ marginTop: '1rem' }}>Optimization Results</div>
                                        <div className="mini-compare-grid">
                                            <div className="mini-compare-header">Metric</div>
                                            <div className="mini-compare-header" style={{ color: '#d97706' }}>IAROA</div>
                                            <div className="mini-compare-header" style={{ color: '#059669' }}>IAROA+MPC</div>
                                            <div className="mini-compare-label">Cost</div>
                                            <div className="mini-compare-val">₹{ioraData.cost_inr}</div>
                                            <div className="mini-compare-val" style={{ color: mpcData.cost_inr <= ioraData.cost_inr ? '#10b981' : '#ef4444' }}>
                                                ₹{mpcData.cost_inr}
                                            </div>
                                            <div className="mini-compare-label">Carbon</div>
                                            <div className="mini-compare-val">{ioraData.carbon_kg} kg</div>
                                            <div className="mini-compare-val" style={{ color: mpcData.carbon_kg <= ioraData.carbon_kg ? '#10b981' : '#ef4444' }}>
                                                {mpcData.carbon_kg} kg
                                            </div>
                                            <div className="mini-compare-label">Import</div>
                                            <div className="mini-compare-val">{ioraData.import_kw} kW</div>
                                            <div className="mini-compare-val">{mpcData.import_kw} kW</div>
                                            <div className="mini-compare-label">Time</div>
                                            <div className="mini-compare-val">{ioraData.computation_ms} ms</div>
                                            <div className="mini-compare-val">{mpcData.computation_ms} ms</div>
                                        </div>
                                    </div>
                                )}

                                {(displayOptResults?.p2p_trades || []).filter(t => t.from === selectedCity || t.to === selectedCity).length > 0 && (
                                    <div style={{ marginTop: '1rem' }}>
                                        <div className="panel-subtitle">Active Trades</div>
                                        {displayOptResults.p2p_trades
                                            .filter(t => t.from === selectedCity || t.to === selectedCity)
                                            .map((t, i) => (
                                                <div key={i} className="trade-pill">
                                                    <span style={{ color: t.from === selectedCity ? '#10b981' : '#3b82f6' }}>
                                                        {t.from === selectedCity ? '→ Selling' : '← Buying'}
                                                    </span>
                                                    <span style={{ fontWeight: 600 }}>{t.amount_kw} kW</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>
                                                        {t.from === selectedCity ? `to ${t.to}` : `from ${t.from}`}
                                                    </span>
                                                    <span style={{ color: '#f59e0b' }}>₹{t.price_inr}</span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        );
                    })() : (
                        <div className="city-placeholder">
                            <MapPin size={48} color="var(--text-muted)" strokeWidth={1} />
                            <p>Click a city on the map to view its microgrid details</p>
                        </div>
                    )}
                </div>
            </div>

            {/* === CITY OVERVIEW CARDS === */}
            <div className="city-cards-row">
                {displayCities.map(city => (
                    <div key={city.id}
                        className={`city-card ${selectedCity === city.id ? 'city-card-selected' : ''}`}
                        onClick={() => setSelectedCity(selectedCity === city.id ? null : city.id)}
                        style={{ borderColor: `${getStatusColor(city.status)}40` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: getStatusColor(city.status),
                                boxShadow: `0 0 8px ${getStatusColor(city.status)}`
                            }} />
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{city.name}</span>
                        </div>
                        <div style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: '0.4rem', fontSize: '0.8rem' }}>
                            <div><Sun size={10} color="#facc15" /> {city.pv_now_kw}</div>
                            <div><Wind size={10} color="#93c5fd" /> {city.wind_now_kw}</div>
                            <div><Flame size={10} color="#f87171" /> {city.thermal_now_kw}</div>
                            <div><Building size={10} color="#3b82f6" /> {city.load_now_kw}</div>
                        </div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, marginTop: '0.25rem', color: getStatusColor(city.status) }}>
                            {city.net_power_kw > 0 ? `+${city.net_power_kw}` : city.net_power_kw} kW net
                        </div>
                    </div>
                ))}
            </div>

            {/* ============================
                CALCULATION EXPLAINER PANEL
                (always visible)
            ============================ */}
            <CalcExplainerPanel optSettings={optSettings} />

            {/* === COMPARISON DASHBOARD === */}
            {displayOptResults && (
                <div className="comparison-section glass-panel">
                    <div className="panel-title" style={{ marginBottom: '1rem' }}>
                        <BarChart3 size={22} color="#7c3aed" /> Algorithm Comparison: IAROA vs IAROA+MPC
                    </div>

                    {/* Summary Cards */}
                    <div className="compare-summary-grid">
                        <div className="compare-verdict-card">
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Verdict</div>
                            <div style={{
                                fontSize: '1.4rem', fontWeight: 700,
                                color: displayOptResults.comparison.verdict === 'IAROA+MPC' ? '#059669' : '#d97706'
                            }}>
                                🏆 {displayOptResults.comparison.verdict}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                {displayOptResults.comparison.verdict_reason}
                            </div>
                        </div>

                        <div className="compare-metric-card">
                            <div className="compare-metric-title"><IndianRupee size={14} /> Total Cost</div>
                            <div className="compare-bars">
                                {[
                                    { label: 'IAROA', val: displayOptResults.iora_only.total_cost_inr, cls: 'iora' },
                                    { label: '+MPC', val: displayOptResults.iora_mpc.total_cost_inr, cls: 'mpc' },
                                ].map(r => (
                                    <div key={r.label} className="compare-bar-row">
                                        <span className="compare-bar-label">{r.label}</span>
                                        <div className="compare-bar-track">
                                            <div className={`compare-bar-fill ${r.cls}`} style={{
                                                width: `${Math.min(100, (r.val / Math.max(
                                                    displayOptResults.iora_only.total_cost_inr,
                                                    displayOptResults.iora_mpc.total_cost_inr, 1
                                                )) * 100)}%`
                                            }} />
                                        </div>
                                        <span className="compare-bar-value">₹{r.val}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="compare-metric-card">
                            <div className="compare-metric-title"><Leaf size={14} /> Carbon Emissions</div>
                            <div className="compare-bars">
                                {[
                                    { label: 'IAROA', val: displayOptResults.iora_only.total_carbon_kg, cls: 'iora' },
                                    { label: '+MPC', val: displayOptResults.iora_mpc.total_carbon_kg, cls: 'mpc' },
                                ].map(r => (
                                    <div key={r.label} className="compare-bar-row">
                                        <span className="compare-bar-label">{r.label}</span>
                                        <div className="compare-bar-track">
                                            <div className={`compare-bar-fill ${r.cls}`} style={{
                                                width: `${Math.min(100, (r.val / Math.max(
                                                    displayOptResults.iora_only.total_carbon_kg,
                                                    displayOptResults.iora_mpc.total_carbon_kg, 0.01
                                                )) * 100)}%`
                                            }} />
                                        </div>
                                        <span className="compare-bar-value">{r.val} kg</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="compare-metric-card">
                            <div className="compare-metric-title"><Activity size={14} /> Computation Time</div>
                            <div className="compare-bars">
                                {[
                                    { label: 'IAROA', val: displayOptResults.iora_only.total_computation_ms, cls: 'iora' },
                                    { label: '+MPC', val: displayOptResults.iora_mpc.total_computation_ms, cls: 'mpc' },
                                ].map(r => (
                                    <div key={r.label} className="compare-bar-row">
                                        <span className="compare-bar-label">{r.label}</span>
                                        <div className="compare-bar-track">
                                            <div className={`compare-bar-fill ${r.cls}`} style={{
                                                width: `${Math.min(100, (r.val / Math.max(
                                                    displayOptResults.iora_only.total_computation_ms,
                                                    displayOptResults.iora_mpc.total_computation_ms, 1
                                                )) * 100)}%`
                                            }} />
                                        </div>
                                        <span className="compare-bar-value">{r.val} ms</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Per-City Comparison Table */}
                    <div style={{ marginTop: '1.5rem', overflowX: 'auto' }}>
                        <div className="panel-subtitle" style={{ marginBottom: '0.75rem' }}>Per-City Breakdown</div>
                        <table className="compare-table">
                            <thead>
                                <tr>
                                    <th>City</th>
                                    <th colSpan="2">Cost (₹)</th>
                                    <th colSpan="2">Carbon (kg)</th>
                                    <th colSpan="2">Import (kW)</th>
                                    <th colSpan="2">Time (ms)</th>
                                </tr>
                                <tr className="compare-table-sub-header">
                                    <th />
                                    <th style={{ color: '#d97706' }}>IAROA</th>
                                    <th style={{ color: '#10b981' }}>+MPC</th>
                                    <th style={{ color: '#d97706' }}>IAROA</th>
                                    <th style={{ color: '#10b981' }}>+MPC</th>
                                    <th style={{ color: '#d97706' }}>IAROA</th>
                                    <th style={{ color: '#10b981' }}>+MPC</th>
                                    <th style={{ color: '#d97706' }}>IAROA</th>
                                    <th style={{ color: '#10b981' }}>+MPC</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.keys(displayOptResults.iora_only.per_city).map(cid => {
                                    const iora = displayOptResults.iora_only.per_city[cid];
                                    const mpc = displayOptResults.iora_mpc.per_city[cid];
                                    return (
                                        <tr key={cid} onClick={() => setSelectedCity(cid)} style={{ cursor: 'pointer' }}
                                            className={selectedCity === cid ? 'table-row-selected' : ''}>
                                            <td style={{ fontWeight: 600 }}>{iora.city}</td>
                                            <td>₹{iora.cost_inr}</td>
                                            <td style={{ color: mpc.cost_inr <= iora.cost_inr ? '#10b981' : '#ef4444' }}>₹{mpc.cost_inr}</td>
                                            <td>{iora.carbon_kg}</td>
                                            <td style={{ color: mpc.carbon_kg <= iora.carbon_kg ? '#10b981' : '#ef4444' }}>{mpc.carbon_kg}</td>
                                            <td>{iora.import_kw}</td>
                                            <td>{mpc.import_kw}</td>
                                            <td>{iora.computation_ms}</td>
                                            <td>{mpc.computation_ms}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* P2P Trades */}
                    {displayOptResults.p2p_trades?.length > 0 && (
                        <div style={{ marginTop: '1.5rem' }}>
                            <div className="panel-subtitle" style={{ marginBottom: '0.75rem' }}>
                                <ArrowRightLeft size={16} /> Peer-to-Peer Energy Trades
                            </div>
                            <div className="trades-grid">
                                {displayOptResults.p2p_trades.map((trade, i) => (
                                    <div key={i} className="trade-card">
                                        <div className="trade-flow">
                                            <span style={{ color: '#10b981', fontWeight: 600 }}>
                                                {CITIES_META[trade.from]?.name || trade.from}
                                            </span>
                                            <span className="trade-arrow">→</span>
                                            <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                                                {CITIES_META[trade.to]?.name || trade.to}
                                            </span>
                                        </div>
                                        <div className="trade-details">
                                            <span><Zap size={12} /> {trade.amount_kw} kW</span>
                                            <span><IndianRupee size={12} /> ₹{trade.price_inr}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* === FULL DAY REPORT === */}
            {simResults && simResults.length > 0 && !simulating && (
                <FullDayReport simResults={simResults} selectedDate={selectedDate} />
            )}
        </div>
    );
}


// ============================
// FULL DAY REPORT
// ============================
function FullDayReport({ simResults, selectedDate }) {
    if (!simResults || simResults.length === 0) return null;

    const costData = simResults.map(hr => ({
        hour: `${hr.hour.toString().padStart(2, '0')}:00`,
        'IAROA Cost': Math.round(hr.iora_only.total_cost_inr * 100) / 100,
        'MPC Cost': Math.round(hr.iora_mpc.total_cost_inr * 100) / 100,
    }));

    const carbonData = simResults.map(hr => ({
        hour: `${hr.hour.toString().padStart(2, '0')}:00`,
        'IAROA Carbon': Math.round(hr.iora_only.total_carbon_kg * 100) / 100,
        'MPC Carbon': Math.round(hr.iora_mpc.total_carbon_kg * 100) / 100,
    }));

    const cityIds = Object.keys(simResults[0].city_opt_results);
    const genLoadData = simResults.map(hr => {
        const row = { hour: `${hr.hour.toString().padStart(2, '0')}:00` };
        let totalGen = 0, totalLoad = 0;
        cityIds.forEach(cid => {
            const c = hr.city_opt_results[cid];
            totalGen += c.tot_gen_now;
            totalLoad += c.load_now;
        });
        row['Total Generation'] = Math.round(totalGen * 100) / 100;
        row['Total Load'] = Math.round(totalLoad * 100) / 100;
        row['Net Surplus'] = Math.round((totalGen - totalLoad) * 100) / 100;
        return row;
    });

    const socData = simResults.map(hr => {
        const row = { hour: `${hr.hour.toString().padStart(2, '0')}:00` };
        cityIds.forEach(cid => {
            row[CITIES_META[cid]?.name || cid] = hr.city_opt_results[cid].soc_pct;
        });
        return row;
    });

    const p2pData = simResults.map(hr => ({
        hour: `${hr.hour.toString().padStart(2, '0')}:00`,
        'P2P Trades': hr.p2p_trades_mpc?.length || 0,
        'Trade Volume': hr.p2p_trades_mpc?.reduce((s, t) => s + t.amount_kw, 0) || 0,
    }));

    const totalIoraCost = simResults.reduce((s, h) => s + h.iora_only.total_cost_inr, 0);
    const totalMpcCost = simResults.reduce((s, h) => s + h.iora_mpc.total_cost_inr, 0);
    const totalIoraCarbon = simResults.reduce((s, h) => s + h.iora_only.total_carbon_kg, 0);
    const totalMpcCarbon = simResults.reduce((s, h) => s + h.iora_mpc.total_carbon_kg, 0);
    const totalP2pTrades = simResults.reduce((s, h) => s + (h.p2p_trades_mpc?.length || 0), 0);
    const totalTradeVolume = simResults.reduce((s, h) => s + (h.p2p_trades_mpc?.reduce((a, t) => a + t.amount_kw, 0) || 0), 0);
    const costSaving = totalIoraCost - totalMpcCost;
    const carbonSaving = totalIoraCarbon - totalMpcCarbon;

    return (
        <div className="full-day-report glass-panel" style={{ marginTop: '2rem' }}>
            <div className="panel-title" style={{ marginBottom: '1.5rem', fontSize: '1.2rem' }}>
                <FileText size={24} color="#60a5fa" />
                <span style={{ color: '#2563eb', fontWeight: 700 }}>
                    Full Day Report — {new Date(selectedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
            </div>

            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '1rem', marginBottom: '2rem'
            }}>
                {[
                    { icon: <IndianRupee size={20} />, val: `₹${totalIoraCost.toFixed(1)}`, label: 'Total IAROA Cost', accent: '#f59e0b' },
                    { icon: <IndianRupee size={20} />, val: `₹${totalMpcCost.toFixed(1)}`, label: 'Total MPC Cost', accent: '#10b981' },
                    { icon: <TrendingDown size={20} />, val: `${costSaving > 0 ? '-' : '+'}₹${Math.abs(costSaving).toFixed(1)}`, label: 'MPC Savings', accent: costSaving > 0 ? '#10b981' : '#ef4444' },
                    { icon: <Leaf size={20} />, val: `${carbonSaving.toFixed(1)} kg`, label: 'Carbon Saved', accent: '#8b5cf6' },
                    { icon: <ArrowRightLeft size={20} />, val: totalP2pTrades, label: 'P2P Trades', accent: '#3b82f6' },
                    { icon: <Zap size={20} />, val: `${totalTradeVolume.toFixed(1)} kW`, label: 'Trade Volume', accent: '#ec4899' },
                ].map((s, i) => (
                    <div key={i} className="report-stat-card" style={{ '--accent': s.accent }}>
                        {s.icon}
                        <div>
                            <div className="report-stat-value">{s.val}</div>
                            <div className="report-stat-label">{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="report-chart-card">
                    <div className="report-chart-title"><IndianRupee size={16} /> Hourly Cost Comparison (₹)</div>
                    <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={costData}>
                            <defs>
                                <linearGradient id="gradIora" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#d97706" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#d97706" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="gradMpc" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#059669" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                            <YAxis stroke="#94a3b8" fontSize={10} />
                            <Tooltip {...CHART_TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            <Area type="monotone" dataKey="IAROA Cost" stroke="#d97706" fill="url(#gradIora)" strokeWidth={2.5} dot={{ r: 3, fill: '#d97706' }} />
                            <Area type="monotone" dataKey="MPC Cost" stroke="#059669" fill="url(#gradMpc)" strokeWidth={2.5} dot={{ r: 3, fill: '#059669' }} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div className="report-chart-card">
                    <div className="report-chart-title"><Leaf size={16} /> Hourly Carbon Emissions (kg CO₂)</div>
                    <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={carbonData}>
                            <defs>
                                <linearGradient id="gradIoraC" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#dc2626" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="gradMpcC" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                            <YAxis stroke="#94a3b8" fontSize={10} />
                            <Tooltip {...CHART_TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            <Area type="monotone" dataKey="IAROA Carbon" stroke="#dc2626" fill="url(#gradIoraC)" strokeWidth={2.5} dot={{ r: 3, fill: '#dc2626' }} />
                            <Area type="monotone" dataKey="MPC Carbon" stroke="#7c3aed" fill="url(#gradMpcC)" strokeWidth={2.5} dot={{ r: 3, fill: '#7c3aed' }} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                <div className="report-chart-card">
                    <div className="report-chart-title"><Zap size={16} /> Network Generation vs Load (kW)</div>
                    <ResponsiveContainer width="100%" height={260}>
                        <ComposedChart data={genLoadData}>
                            <defs>
                                <linearGradient id="gradGen" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#059669" stopOpacity={0.5} />
                                    <stop offset="95%" stopColor="#059669" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                            <YAxis stroke="#94a3b8" fontSize={10} />
                            <Tooltip {...CHART_TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            <Area type="monotone" dataKey="Total Generation" stroke="#059669" fill="url(#gradGen)" strokeWidth={2.5} dot={{ r: 3, fill: '#059669' }} />
                            <Line type="monotone" dataKey="Total Load" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3, fill: '#dc2626' }} strokeDasharray="5 5" />
                            <Bar dataKey="Net Surplus" fill="rgba(37,99,235,0.4)" barSize={14} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                <div className="report-chart-card">
                    <div className="report-chart-title"><Battery size={16} /> Battery SOC by City (%)</div>
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={socData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                            <YAxis stroke="#94a3b8" fontSize={10} domain={[0, 100]} />
                            <Tooltip {...CHART_TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            {cityIds.map(cid => (
                                <Line key={cid} type="monotone"
                                    dataKey={CITIES_META[cid]?.name || cid}
                                    stroke={CITIES_META[cid]?.color || '#888'}
                                    strokeWidth={2.5} dot={{ r: 2 }} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                <div className="report-chart-card" style={{ gridColumn: '1 / -1' }}>
                    <div className="report-chart-title"><ArrowRightLeft size={16} /> P2P Trading Activity</div>
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={p2pData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} />
                            <YAxis yAxisId="left" stroke="#94a3b8" fontSize={10} />
                            <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={10} />
                            <Tooltip {...CHART_TOOLTIP_STYLE} />
                            <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                            <Bar yAxisId="left" dataKey="P2P Trades" fill="rgba(37,99,235,0.5)" barSize={18} />
                            <Line yAxisId="right" type="monotone" dataKey="Trade Volume" stroke="#d97706" strokeWidth={2.5} dot={{ r: 3, fill: '#d97706' }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

export default DecentralizedView;
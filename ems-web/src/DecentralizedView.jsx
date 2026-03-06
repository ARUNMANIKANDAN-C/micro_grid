import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadialBarChart, RadialBar, Cell
} from 'recharts';

const API = 'http://127.0.0.1:8001';

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
    north: '#2563eb', west: '#d97706', south: '#059669',
    delhi: '#3b82f6', jaipur: '#8b5cf6', lucknow: '#06b6d4',
    mumbai: '#f59e0b', pune: '#ef4444', ahmedabad: '#f97316',
    chennai: '#10b981', kolkata: '#a855f7', bangalore: '#ec4899',
    surplus: '#22c55e', deficit: '#ef4444', balanced: '#3b82f6',
    iaroa: '#d97706', mpc: '#059669',
};
const CLUSTER_COL = { north: '#3b82f6', west: '#f59e0b', south: '#10b981' };
const CLUSTERS = {
    north: ['delhi', 'jaipur', 'lucknow'],
    west: ['mumbai', 'pune', 'ahmedabad'],
    south: ['chennai', 'kolkata', 'bangalore']
};

// ─── Map positions (SVG) ─────────────────────────────────────────────────────
const MAP_POS = {
    delhi: { x: 200, y: 110 }, jaipur: { x: 158, y: 163 }, lucknow: { x: 245, y: 148 },
    mumbai: { x: 132, y: 272 }, pune: { x: 148, y: 300 }, ahmedabad: { x: 120, y: 218 },
    chennai: { x: 228, y: 362 }, kolkata: { x: 328, y: 210 }, bangalore: { x: 208, y: 335 },
};
const INDIA_PATH = `M180 58 L222 52 L252 68 L284 63 L314 80 L346 92 L364 124 L372 162
 L368 194 L352 214 L342 244 L330 264 L312 282 L292 304 L272 332
 L252 360 L240 382 L228 397 L218 392 L208 377 L194 352 L173 330
 L153 310 L138 291 L122 262 L116 241 L112 210 L118 180 L128 152
 L140 122 L154 91 L170 69 Z`;

const CITY_META = {
    delhi: { name: 'Delhi', cluster: 'north' }, jaipur: { name: 'Jaipur', cluster: 'north' },
    lucknow: { name: 'Lucknow', cluster: 'north' }, mumbai: { name: 'Mumbai', cluster: 'west' },
    pune: { name: 'Pune', cluster: 'west' }, ahmedabad: { name: 'Ahmedabad', cluster: 'west' },
    chennai: { name: 'Chennai', cluster: 'south' }, kolkata: { name: 'Kolkata', cluster: 'south' },
    bangalore: { name: 'Bangalore', cluster: 'south' },
};

const TOOLTIP_STYLE = {
    contentStyle: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', boxShadow: '0 4px 16px rgba(0,0,0,.08)' },
    labelStyle: { color: '#64748b', fontWeight: 600 }
};

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
const statusColor = s => s === 'surplus' ? C.surplus : s === 'deficit' ? C.deficit : C.balanced;
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);
const fmt = n => typeof n === 'number' ? n.toFixed(2) : '—';

// ══════════════════════════════════════════════════════════════════════════════
// CALCULATION EXPLAINER
// ══════════════════════════════════════════════════════════════════════════════
function FormulaBox({ settings }) {
    const [open, setOpen] = useState(false);
    const s = settings || {};
    const ef = s.grid_emission_factor ?? 0.5, ct = s.carbon_tax ?? 2, deg = s.deg_cost_per_kwh ?? 0.5,
        pdc = s.peak_demand_charge ?? 150, ech = s.battery_eta_ch ?? 0.95, edis = s.battery_eta_dis ?? 0.95,
        soh_d = s.soh_decay_per_cycle ?? 0.0001;
    return (
        <div style={{ borderRadius: 12, border: '1px solid #bae6fd', background: 'linear-gradient(135deg,#f0f9ff,#e0f2fe)', marginBottom: 20, overflow: 'hidden' }}>
            <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 18 }}>🧮</span>
                    <span style={{ fontWeight: 700, color: '#0c4a6e', fontSize: '0.95rem' }}>Cost, Carbon &amp; Battery Degradation Formulas</span>
                    <span style={{ background: '#0284c7', color: 'white', fontSize: '0.6rem', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>LIVE PARAMS</span>
                </div>
                <span style={{ color: '#0369a1', fontSize: 18 }}>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
                <div style={{ padding: '0 18px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                    {/* Cost */}
                    <div style={{ background: 'white', borderRadius: 10, padding: 14, border: '1px solid #fde68a' }}>
                        <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>💰 Total Cost Formula</div>
                        <code style={{ display: 'block', background: '#fefce8', borderRadius: 6, padding: '8px 10px', fontSize: '0.72rem', lineHeight: 1.8, color: '#78350f' }}>
                            Cost = E_cost + Deg + Demand + Carbon<br />
                            E_cost = P_imp × ImpPrice − P_exp × ExpPrice<br />
                            Deg &nbsp;&nbsp;&nbsp;= P_dis × SOH_f × ₹{deg}/kWh<br />
                            Demand = max(P_imp) × ₹{pdc}/kW<br />
                            Carbon = P_imp × {ef} × ₹{ct}/kg<br />
                            P2P &nbsp;&nbsp;&nbsp;= Trade × ₹{s.p2p_price_inr_per_kwh}/kWh<br />
                            DR &nbsp;&nbsp;&nbsp;&nbsp;= PeakLoad reduction {(s.demand_response_discount * 100).toFixed(0)}%
                        </code>
                        <div style={{ marginTop: 8, fontSize: '0.71rem', color: '#6b7280', lineHeight: 1.6 }}>
                            SOH_factor = 2 − SOH (higher cost when battery degrades)<br />
                            Import price varies hourly (₹3–₹13/kWh); export = 50% of import
                        </div>
                    </div>
                    {/* Carbon */}
                    <div style={{ background: 'white', borderRadius: 10, padding: 14, border: '1px solid #bbf7d0' }}>
                        <div style={{ fontWeight: 700, color: '#064e3b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>🌱 Carbon Emissions</div>
                        <code style={{ display: 'block', background: '#f0fdf4', borderRadius: 6, padding: '8px 10px', fontSize: '0.72rem', lineHeight: 1.8, color: '#065f46' }}>
                            Carbon = P_imp × EF<br />
                            EF = {ef} kg CO₂/kWh<br />
                            ∴ 10 kW import → {(10 * ef).toFixed(1)} kg CO₂<br />
                            Carbon_cost = Carbon × ₹{ct}/kg
                        </code>
                        <div style={{ marginTop: 8, fontSize: '0.71rem', color: '#6b7280', lineHeight: 1.6 }}>
                            Only grid imports counted. Local PV/wind/thermal = zero-emission.
                            P2P trades displace grid imports → cut network carbon.
                        </div>
                    </div>
                    {/* Battery */}
                    <div style={{ background: 'white', borderRadius: 10, padding: 14, border: '1px solid #ddd6fe' }}>
                        <div style={{ fontWeight: 700, color: '#4c1d95', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>🔋 Battery Degradation (SOH)</div>
                        <code style={{ display: 'block', background: '#faf5ff', borderRadius: 6, padding: '8px 10px', fontSize: '0.72rem', lineHeight: 1.8, color: '#5b21b6' }}>
                            SOH(t+1) = SOH(t) − decay × throughput<br />
                            throughput = (|Pch|+|Pdis|)/(2×C)<br />
                            decay = {soh_d} per unit-cycle<br />
                            Charge η = {(ech * 100).toFixed(0)}% | Dis η = {(edis * 100).toFixed(0)}%
                        </code>
                        <div style={{ marginTop: 8, fontSize: '0.71rem', color: '#6b7280', lineHeight: 1.6 }}>
                            SOH 1.0 = new; 0.5 = end-of-life. Degradation cost rises as SOH falls.
                            Hierarchical MPC minimises unnecessary cycling.
                        </div>
                    </div>
                    {/* Algorithms */}
                    <div style={{ gridColumn: '1/-1', background: 'white', borderRadius: 10, padding: 14, border: '1px solid #e0e7ff', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        {[
                            {
                                icon: '🐇', title: 'IAROA (24h global)', col: '#d97706', pts: [
                                    'Population-based metaheuristic over full 24 h horizon',
                                    'Optimises Pch, Pdis, curtailment jointly per city',
                                    'Minimises total cost objective (4 terms above)',
                                    'Decentralised — no data shared between cities',
                                ]
                            },
                            {
                                icon: '🎯', title: 'Local MPC (real-time)', col: '#059669', pts: [
                                    'Single-step heuristic correction per city',
                                    'Discharge when imp_price > avg → avoid peak tariff',
                                    'Charge from surplus PV when price < 85% avg',
                                    'Accounts for SOH-adjusted degradation cost',
                                ]
                            },
                            {
                                icon: '🏗️', title: 'Hierarchical Layers', col: '#7c3aed', pts: [
                                    'Local: buildings + EV + battery per city',
                                    'Regional: balance 3-city cluster, intra-cluster P2P',
                                    'Global: cross-cluster arbitrage + grid balancing',
                                    'Each layer reduces cost & carbon progressively',
                                ]
                            },
                        ].map(a => (
                            <div key={a.title} style={{ background: '#fafafa', borderRadius: 8, padding: '10px 12px', borderLeft: `3px solid ${a.col}` }}>
                                <div style={{ fontWeight: 700, color: a.col, marginBottom: 6, fontSize: '0.78rem' }}>{a.icon} {a.title}</div>
                                <ul style={{ margin: 0, paddingLeft: 14, fontSize: '0.71rem', color: '#374151', lineHeight: 1.7 }}>
                                    {a.pts.map((p, i) => <li key={i}>{p}</li>)}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════════════════════════
function SettingsModal({ settings, onSave, onClose, saving }) {
    const [s, setS] = useState({ ...settings });
    const fields = [
        { k: 'deg_cost_per_kwh', label: 'Degradation Cost (₹/kWh)', step: 0.05, min: 0 },
        { k: 'peak_demand_charge', label: 'Peak Demand Charge (₹/kW)', step: 10, min: 0 },
        { k: 'grid_emission_factor', label: 'Grid Emission Factor (kg CO₂/kWh)', step: 0.01, min: 0 },
        { k: 'carbon_tax', label: 'Carbon Tax (₹/kg CO₂)', step: 0.5, min: 0 },
        { k: 'battery_eta_ch', label: 'Battery Charge Efficiency', step: 0.01, min: 0.5, max: 1 },
        { k: 'battery_eta_dis', label: 'Battery Discharge Efficiency', step: 0.01, min: 0.5, max: 1 },
        { k: 'soh_decay_per_cycle', label: 'SOH Decay per Cycle', step: 0.00005, min: 0 },
        { k: 'p2p_price_inr_per_kwh', label: 'P2P Trade Price (₹/kWh)', step: 0.5, min: 0 },
        { k: 'demand_response_discount', label: 'Demand Response Discount (0.0-1.0)', step: 0.05, min: 0, max: 0.8 },
    ];
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.65)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '92%', maxWidth: 620, boxShadow: '0 25px 50px rgba(0,0,0,.25)', maxHeight: '90vh', overflow: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#1e293b' }}>⚙️ Optimization Parameters</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#94a3b8' }}>✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', marginBottom: 20 }}>
                    {fields.map(f => (
                        <div key={f.k}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{f.label}</label>
                            <input type="number" step={f.step} min={f.min} max={f.max}
                                value={s[f.k] ?? ''}
                                onChange={e => setS({ ...s, [f.k]: parseFloat(e.target.value) })}
                                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => onSave(s)} disabled={saving} style={{ flex: 1, padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        {saving ? '⏳ Saving...' : '✅ Save & Apply Globally'}
                    </button>
                    <button onClick={onClose} style={{ padding: '10px 18px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// BATTERY HEALTH WIDGET
// ══════════════════════════════════════════════════════════════════════════════
function BatteryHealthPanel({ cities }) {
    if (!cities.length) return null;
    return (
        <div style={{ background: 'white', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                🔋 Battery Health (SOH) — All Cities
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                {cities.map(c => {
                    const soh = c.soh ?? 1;
                    const pct = Math.round(soh * 100);
                    const col = soh > 0.85 ? '#22c55e' : soh > 0.70 ? '#f59e0b' : '#ef4444';
                    const status = soh > 0.85 ? '✅ Healthy' : soh > 0.70 ? '⚠️ Degraded' : '🚨 Critical';
                    return (
                        <div key={c.id} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', border: `1px solid ${col}30` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontWeight: 700, fontSize: '0.8rem', color: '#1e293b' }}>{c.name}</span>
                                <span style={{ fontSize: '0.65rem', color: col, fontWeight: 700 }}>{status}</span>
                            </div>
                            <div style={{ height: 6, background: '#e2e8f0', borderRadius: 4, marginBottom: 4, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${col},${col}bb)`, borderRadius: 4, transition: 'width .5s' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#64748b' }}>
                                <span>SOH {pct}%</span>
                                <span>{c.soc_pct}% SOC</span>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 3 }}>
                                Cycles: {typeof c.cycles === 'number' ? c.cycles.toFixed(1) : '—'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE METRICS PANEL
// ══════════════════════════════════════════════════════════════════════════════
function PerfMetrics({ perf, totalMs }) {
    if (!perf) return null;
    const rows = Object.entries(perf).map(([cid, p]) => ({
        city: CITY_META[cid]?.name || cid,
        iaroa_ms: p.iaroa_ms, mpc_ms: p.mpc_ms, total_ms: p.total_ms,
        iters: p.iterations, improvement: p.improvement_pct,
    }));
    return (
        <div style={{ background: 'white', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
                ⚡ Performance Metrics
                <span style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 20, padding: '2px 10px', fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                    Total: {totalMs?.toFixed(0)} ms
                </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.77rem' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc' }}>
                            {['City', 'IAROA (ms)', 'MPC (ms)', 'Total (ms)', 'Iterations', 'Improvement %'].map(h => (
                                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '7px 10px', fontWeight: 600, color: '#1e293b' }}>{r.city}</td>
                                <td style={{ padding: '7px 10px', color: C.iaroa }}>{r.iaroa_ms?.toFixed(1)}</td>
                                <td style={{ padding: '7px 10px', color: C.mpc }}>{r.mpc_ms?.toFixed(2)}</td>
                                <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.total_ms?.toFixed(1)}</td>
                                <td style={{ padding: '7px 10px' }}>{r.iters}</td>
                                <td style={{ padding: '7px 10px', color: r.improvement > 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                                    {r.improvement?.toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// HIERARCHICAL MPC DISPLAY
// ══════════════════════════════════════════════════════════════════════════════
function HierarchyPanel({ hData }) {
    if (!hData) return null;
    const { local, regional, global: glob } = hData;
    return (
        <div style={{ background: 'white', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
            <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 14 }}>🏗️ Hierarchical MPC Layers</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                {/* Local */}
                <div style={{ background: '#f0fdf4', borderRadius: 10, padding: 14, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontWeight: 700, color: '#065f46', marginBottom: 10, fontSize: '0.85rem' }}>📍 Local MPC (per-city)</div>
                    {local && Object.entries(local).map(([cid, d]) => (
                        <div key={cid} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #dcfce7', fontSize: '0.72rem' }}>
                            <span style={{ color: '#374151', fontWeight: 600 }}>{CITY_META[cid]?.name}</span>
                            <span style={{ color: '#059669' }}>Ch: {d.Pch} kW</span>
                            <span style={{ color: '#d97706' }}>Dis: {d.Pdis} kW</span>
                        </div>
                    ))}
                </div>
                {/* Regional */}
                <div style={{ background: '#eff6ff', borderRadius: 10, padding: 14, border: '1px solid #bfdbfe' }}>
                    <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: 10, fontSize: '0.85rem' }}>🔗 Regional MPC (clusters)</div>
                    {regional && Object.entries(regional).map(([cl, r]) => (
                        <div key={cl} style={{ marginBottom: 10 }}>
                            <div style={{ fontWeight: 700, color: CLUSTER_COL[cl], fontSize: '0.75rem', marginBottom: 4 }}>
                                {cl.toUpperCase()} — Net: {r.cluster_net_kw} kW
                            </div>
                            {r.intra_trades?.map((t, i) => (
                                <div key={i} style={{ fontSize: '0.68rem', color: '#374151', padding: '2px 0' }}>
                                    {CITY_META[t.from]?.name} → {CITY_META[t.to]?.name}: {t.amount_kw} kW (₹{t.price_inr})
                                </div>
                            ))}
                            {(!r.intra_trades || r.intra_trades.length === 0) && (
                                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>No intra-cluster trades</div>
                            )}
                        </div>
                    ))}
                </div>
                {/* Global */}
                <div style={{ background: '#faf5ff', borderRadius: 10, padding: 14, border: '1px solid #ddd6fe' }}>
                    <div style={{ fontWeight: 700, color: '#4c1d95', marginBottom: 10, fontSize: '0.85rem' }}>🌐 Global MPC (grid)</div>
                    {glob && (
                        <>
                            <div style={{ marginBottom: 8, fontSize: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ color: '#64748b' }}>Total Net:</span>
                                    <span style={{ fontWeight: 700, color: glob.total_net_kw >= 0 ? '#22c55e' : '#ef4444' }}>{glob.total_net_kw} kW</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ color: '#64748b' }}>Grid Import:</span>
                                    <span style={{ fontWeight: 700, color: '#ef4444' }}>{glob.grid_import_kw} kW</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ color: '#64748b' }}>Grid Export:</span>
                                    <span style={{ fontWeight: 700, color: '#22c55e' }}>{glob.grid_export_kw} kW</span>
                                </div>
                            </div>
                            <div style={{ fontWeight: 700, color: '#7c3aed', fontSize: '0.72rem', marginBottom: 4 }}>Cross-Cluster Trades:</div>
                            {glob.cross_cluster_trades?.map((t, i) => (
                                <div key={i} style={{ fontSize: '0.68rem', color: '#374151', padding: '2px 0' }}>
                                    {t.from.toUpperCase()} → {t.to.toUpperCase()}: {t.amount_kw} kW (₹{t.price_inr})
                                </div>
                            ))}
                            {(!glob.cross_cluster_trades || glob.cross_cluster_trades.length === 0) && (
                                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>No cross-cluster trades</div>
                            )}
                            <div style={{ marginTop: 8, padding: '6px 8px', background: glob.balance_achieved ? '#f0fdf4' : '#fef2f2', borderRadius: 6, fontSize: '0.7rem', fontWeight: 700, color: glob.balance_achieved ? '#065f46' : '#991b1b' }}>
                                {glob.balance_achieved ? '✅ Grid Balanced' : '⚠️ Imbalance Detected'}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// WEATHER PANEL
// ══════════════════════════════════════════════════════════════════════════════
function WeatherPanel({ cityId, startDate, endDate }) {
    const [wx, setWx] = useState(null);
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState('historical');

    useEffect(() => {
        if (!cityId) return;
        setLoading(true);
        fetch(`${API}/weather/${cityId}?start_date=${startDate}&end_date=${endDate}`)
            .then(r => r.json()).then(setWx).catch(() => setWx(null)).finally(() => setLoading(false));
    }, [cityId, startDate, endDate]);

    if (!cityId) return (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8', fontSize: '0.85rem' }}>
            Select a city to view weather data
        </div>
    );
    if (loading) return <div style={{ textAlign: 'center', padding: 20, color: '#64748b' }}>⏳ Loading weather...</div>;
    if (!wx) return <div style={{ textAlign: 'center', padding: 20, color: '#ef4444' }}>Weather unavailable</div>;

    const data = (tab === 'historical' ? wx.historical : wx.forecast) || {};
    const temps = data.temperature_2m || [];
    const winds = data.wind_speed_10m || [];
    const solar = data.shortwave_radiation || [];
    const hours = Math.min(24, temps.length);
    const chartData = Array.from({ length: hours }, (_, i) => ({
        h: `${i.toString().padStart(2, '0')}:00`,
        Temp: typeof temps[i] === 'number' ? +temps[i].toFixed(1) : null,
        Wind: typeof winds[i] === 'number' ? +winds[i].toFixed(1) : null,
        Solar: typeof solar[i] === 'number' ? +(solar[i] / 10).toFixed(1) : null,
    }));

    return (
        <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {['historical', 'forecast'].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem',
                        background: tab === t ? '#2563eb' : '#f1f5f9', color: tab === t ? 'white' : '#64748b',
                    }}>{t === 'historical' ? '📊 Historical' : '🔮 Forecast'}</button>
                ))}
            </div>
            <div style={{ height: 200, minHeight: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="h" fontSize={9} stroke="#94a3b8" interval={3} />
                        <YAxis yAxisId="left" fontSize={9} stroke="#94a3b8" />
                        <YAxis yAxisId="right" orientation="right" fontSize={9} stroke="#f59e0b" />
                        <Tooltip {...TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '0.7rem' }} />
                        <Area isAnimationActive={false} yAxisId="left" type="monotone" dataKey="Solar" stroke="#fbbf24" fill="#fef9c3" strokeWidth={2} name="Solar(×10 W/m²)" />
                        <Line isAnimationActive={false} yAxisId="left" type="monotone" dataKey="Temp" stroke="#ef4444" strokeWidth={2} dot={false} name="Temp(°C)" />
                        <Line isAnimationActive={false} yAxisId="right" type="monotone" dataKey="Wind" stroke="#3b82f6" strokeWidth={2} dot={false} name="Wind(m/s)" />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// 24h SIMULATION REPORT
// ══════════════════════════════════════════════════════════════════════════════
function SimReport({ simData, date }) {
    if (!simData?.length) return null;
    const costData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        IAROA: h.totals?.iaroa_cost ?? 0, MPC: h.totals?.mpc_cost ?? 0,
    }));
    const carbonData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        IAROA: h.totals?.iaroa_carbon ?? 0, MPC: h.totals?.mpc_carbon ?? 0,
    }));
    const cityIds = Object.keys(simData[0]?.cities || {});
    const socData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        ...Object.fromEntries(cityIds.map(c => [CITY_META[c]?.name || c, h.cities[c]?.soc_pct ?? 0]))
    }));
    const sohData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        ...Object.fromEntries(cityIds.map(c => [CITY_META[c]?.name || c, +(((h.cities[c]?.soh ?? 1) * 100).toFixed(2))]))
    }));
    const genData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        Generation: +cityIds.reduce((s, c) => (s + (h.cities[c]?.gen_now ?? 0)), 0).toFixed(1),
        Load: +cityIds.reduce((s, c) => (s + (h.cities[c]?.load_now ?? 0)), 0).toFixed(1),
    }));
    const perfData = simData.map(h => ({
        h: `${h.hour.toString().padStart(2, '0')}:00`,
        'Opt Time(ms)': h.totals?.total_ms ?? 0,
    }));
    const totalIaroa = simData.reduce((s, h) => s + (h.totals?.iaroa_cost ?? 0), 0);
    const totalMpc = simData.reduce((s, h) => s + (h.totals?.mpc_cost ?? 0), 0);
    const totalIaroaC = simData.reduce((s, h) => s + (h.totals?.iaroa_carbon ?? 0), 0);
    const totalMpcC = simData.reduce((s, h) => s + (h.totals?.mpc_carbon ?? 0), 0);
    const totalMs = simData.reduce((s, h) => s + (h.totals?.total_ms ?? 0), 0);
    const costSav = totalIaroa - totalMpc;
    const carbSav = totalIaroaC - totalMpcC;

    const isSingleCity = cityIds.length === 1;
    const targetName = isSingleCity ? (CITY_META[cityIds[0]]?.name || 'City') : 'Network';

    const CITY_COLORS = { Delhi: '#3b82f6', Jaipur: '#8b5cf6', Lucknow: '#06b6d4', Mumbai: '#f59e0b', Pune: '#ef4444', Ahmedabad: '#f97316', Chennai: '#10b981', Kolkata: '#a855f7', Bangalore: '#ec4899' };
    return (
        <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)', marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1e293b', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                📋 24-Hour Simulation Report
                <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#64748b' }}>
                    — {new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
            </div>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 20 }}>
                {[
                    { v: `₹${totalIaroa.toFixed(0)}`, l: 'IAROA Total Cost', col: '#d97706' },
                    { v: `₹${totalMpc.toFixed(0)}`, l: 'MPC Total Cost', col: '#059669' },
                    { v: `${costSav > 0 ? '-' : '+'} ₹${Math.abs(costSav).toFixed(0)}`, l: 'MPC Savings', col: costSav > 0 ? '#22c55e' : '#ef4444' },
                    { v: `${carbSav.toFixed(1)} kg`, l: 'Carbon Saved', col: '#8b5cf6' },
                    { v: `${totalMs.toFixed(0)} ms`, l: 'Total Opt. Time', col: '#3b82f6' },
                    { v: `${(totalMs / 24).toFixed(0)} ms`, l: 'Avg per Hour', col: '#06b6d4' },
                ].map((k, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', borderLeft: `3px solid ${k.col}` }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: k.col }}>{k.v}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>{k.l}</div>
                    </div>
                ))}
            </div>
            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>💰 Hourly Cost (₹)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={costData}>
                                <defs>
                                    <linearGradient id="gI" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d97706" stopOpacity=".4" /><stop offset="100%" stopColor="#d97706" stopOpacity=".02" /></linearGradient>
                                    <linearGradient id="gM" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#059669" stopOpacity=".4" /><stop offset="100%" stopColor="#059669" stopOpacity=".02" /></linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                <Area isAnimationActive={false} type="monotone" dataKey="IAROA" stroke="#d97706" fill="url(#gI)" strokeWidth={2} />
                                <Area isAnimationActive={false} type="monotone" dataKey="MPC" stroke="#059669" fill="url(#gM)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>🌱 Carbon Emissions (kg CO₂)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={carbonData}>
                                <defs>
                                    <linearGradient id="gIC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity=".4" /><stop offset="100%" stopColor="#ef4444" stopOpacity=".02" /></linearGradient>
                                    <linearGradient id="gMC" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity=".4" /><stop offset="100%" stopColor="#7c3aed" stopOpacity=".02" /></linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                <Area isAnimationActive={false} type="monotone" dataKey="IAROA" stroke="#ef4444" fill="url(#gIC)" strokeWidth={2} />
                                <Area isAnimationActive={false} type="monotone" dataKey="MPC" stroke="#7c3aed" fill="url(#gMC)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>⚡ Network Gen vs Load (kW)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={genData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                <Area isAnimationActive={false} type="monotone" dataKey="Generation" stroke="#059669" fill="#d1fae5" strokeWidth={2} />
                                <Line isAnimationActive={false} type="monotone" dataKey="Load" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>🔋 Battery SOC by City (%)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={socData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis domain={[0, 100]} fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.68rem' }} />
                                {cityIds.map(c => <Line isAnimationActive={false} key={c} type="monotone" dataKey={CITY_META[c]?.name || c} stroke={CITY_COLORS[CITY_META[c]?.name] || '#888'} strokeWidth={1.5} dot={false} />)}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>🏥 Battery SOH Degradation (%)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={sohData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis domain={[98, 101]} fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.68rem' }} />
                                {cityIds.map(c => <Line isAnimationActive={false} key={c} type="monotone" dataKey={CITY_META[c]?.name || c} stroke={CITY_COLORS[CITY_META[c]?.name] || '#888'} strokeWidth={1.5} dot={false} />)}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#475569', marginBottom: 6 }}>⏱️ Optimization Runtime (ms/hour)</div>
                    <div style={{ height: 200, minHeight: 200 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={perfData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="h" fontSize={9} stroke="#94a3b8" /><YAxis fontSize={9} stroke="#94a3b8" />
                                <Tooltip {...TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                                <Bar isAnimationActive={false} dataKey="Opt Time(ms)" fill="#6366f1" radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ─── SUMMARY ANALYSIS & INFERENCES ─── */}
            <div style={{ marginTop: 24, padding: 20, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <h3 style={{ fontSize: '1.05rem', color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    📊 Executive Summary & Analysis
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

                    {/* Algorithm Comparisons */}
                    <div style={{ background: '#fff', padding: 16, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontWeight: 600, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                            ⚙️ Real-time Algorithm Performance
                        </div>
                        <ul style={{ fontSize: '0.82rem', color: '#475569', margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <li><b>IAROA (Day-Ahead Plan):</b> Generated the optimal 24-hour blueprint for {targetName} with an estimated cost of <b>₹{totalIaroa.toFixed(0)}</b> and <b>{totalIaroaC.toFixed(0)} kg</b> of carbon.</li>
                            <li><b>IAROA + MPC (Live Execution):</b> Reacted to live 15-minute intervals, resulting in an actual cost of <b>₹{totalMpc.toFixed(0)}</b> and <b>{totalMpcC.toFixed(0)} kg</b> of carbon.</li>
                            <li><b>Verdict:</b> The Hybrid MPC {costSav >= 0 ? 'successfully saved' : 'incurred a slight penalty of'} <b>₹{Math.abs(costSav).toFixed(0)}</b> {costSav >= 0 ? 'by capturing real-time inefficiencies' : 'due to unexpected weather deviations'} compared to the pure day-ahead forecast.</li>
                        </ul>
                    </div>

                    {/* Layman Inference */}
                    <div style={{ background: '#fff', padding: 16, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontWeight: 600, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                            🧠 Simulation Inference ({targetName})
                        </div>
                        <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
                            The AI managed {targetName}'s grid effectively by hoarding renewable energy during low-demand periods and discharging the batteries during high-price peak hours.
                            <br /><br />
                            {costSav > 0 ? `By pairing IAROA with the real-time MPC, the system actively corrected minor weather deviations, proving the superior stability of a Hybrid approach over pure metaheuristics.` : `The MPC strictly enforced battery State-of-Health (SOH) protections, ensuring the physical lifespan of the equipment wasn't damaged for short-term financial gain.`}
                        </p>
                    </div>

                    {/* Customer Suggestions */}
                    <div style={{ background: '#fff', padding: 16, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontWeight: 600, color: '#334155', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                            💡 Personalized Iteration Suggestions
                        </div>
                        <div style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ borderLeft: '3px solid #10b981', paddingLeft: 8 }}>
                                <b style={{ color: '#059669' }}>💸 To further optimize COST:</b><br />
                                {costSav > 0 ? `MPC found ₹${Math.abs(costSav).toFixed(0)} of extra savings. Increase the "Demand Response" discount to allow the AI to shift even more evening loads into the night.` : `MPC followed the blueprint closely. Try increasing the battery capacity so the AI can hoard 100% of the noon solar curtailment.`}
                            </div>
                            <div style={{ borderLeft: '3px solid #3b82f6', paddingLeft: 8 }}>
                                <b style={{ color: '#2563eb' }}>🌱 To further reduce CARBON:</b><br />
                                {carbSav > 0 ? `MPC actively diverted ${Math.abs(carbSav).toFixed(1)} kg of CO₂. Crank up the "Carbon Tax" parameter manually to force the AI to penalize fossil-fuel grid imports even harder in the next iteration.` : `Carbon was tightly managed by the IAROA blueprint. For a zero-carbon profile, you must expand ${targetName}'s physical solar/wind capacity.`}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function MicrogridDashboard() {
    const [cities, setCities] = useState([]);
    const [optResult, setOptResult] = useState(null);
    const [simData, setSimData] = useState(null);
    const [settings, setSettings] = useState({ deg_cost_per_kwh: 0.5, peak_demand_charge: 150, grid_emission_factor: 0.5, carbon_tax: 2, battery_eta_ch: 0.95, battery_eta_dis: 0.95, soh_decay_per_cycle: 0.0001, p2p_price_inr_per_kwh: 5, demand_response_discount: 0.15 });
    const [showSettings, setShowSettings] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);
    const [running, setRunning] = useState(false);
    const [simRunning, setSimRunning] = useState(false);
    const [selectedCity, setSelectedCity] = useState(null);
    const [simHour, setSimHour] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(300);
    const [activeTab, setActiveTab] = useState('map');
    const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 2); return d.toISOString().split('T')[0] });
    const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] });
    const [animPhase, setAnimPhase] = useState(0);

    useEffect(() => { const t = setInterval(() => setAnimPhase(p => (p + 1) % 360), 50); return () => clearInterval(t) }, []);
    useEffect(() => {
        let t;
        if (playing && simHour !== null) {
            t = setInterval(() => setSimHour(p => { if (p >= 23) { setPlaying(false); return p; } return p + 1; }), playSpeed);
        }
        return () => clearInterval(t);
    }, [playing, simHour, playSpeed]);

    const fetchCities = useCallback(() => {
        fetch(`${API}/cities?start_date=${startDate}&end_date=${endDate}`)
            .then(r => r.json()).then(d => setCities(d.cities || [])).catch(() => { });
    }, [startDate, endDate]);

    const fetchSettings = useCallback(() => {
        fetch(`${API}/optimization-settings`).then(r => r.json()).then(setSettings).catch(() => { });
    }, []);

    useEffect(() => { fetchSettings(); }, [fetchSettings]);
    useEffect(() => { fetchCities(); const iv = setInterval(fetchCities, 15000); return () => clearInterval(iv); }, [fetchCities]);

    const runOpt = async () => {
        setRunning(true); setSimHour(null); setPlaying(false);
        try {
            const r = await fetch(`${API}/optimize?start_date=${startDate}&end_date=${endDate}`, { method: 'POST' });
            setOptResult(await r.json()); fetchCities();
        } catch (e) { console.error(e); } finally { setRunning(false); }
    };

    const runSim = async () => {
        setSimRunning(true);
        try {
            const r = await fetch(`${API}/simulate-24h?start_date=${startDate}&end_date=${endDate}`, { method: 'POST' });
            const d = await r.json();
            setSimData(d.simulation || []); setSimHour(0); setPlaying(true);
        } catch (e) { console.error(e); } finally { setSimRunning(false); }
    };

    const saveSettings = async (s) => {
        setSavingSettings(true);
        try {
            const r = await fetch(`${API}/optimization-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
            if (r.ok) setSettings(await r.json().then(d => d.settings || d));
            setShowSettings(false);
        } catch (e) { } finally { setSavingSettings(false); }
    };

    const resetStates = async () => {
        if (window.confirm("Are you sure you want to reset all city states and battery health?")) {
            try {
                await fetch(`${API}/reset-states`, { method: 'POST' });
                fetchCities();
            } catch (e) { console.error(e); }
        }
    };

    const displayCities = useMemo(() => {
        if (simHour !== null && simData?.[simHour]) {
            const h = simData[simHour];
            return cities.map(c => {
                const cd = h.cities?.[c.id];
                if (!cd) return c;
                return {
                    ...c,
                    pv_now: cd.pv_now ?? c.pv_now,
                    wind_now: cd.wind_now ?? c.wind_now,
                    thermal_now: cd.thermal_now ?? c.thermal_now,
                    gen_total: cd.gen_now ?? c.gen_total,
                    load_now: cd.load_now ?? c.load_now,
                    net_kw: cd.net_kw ?? c.net_kw,
                    soc_pct: cd.soc_pct ?? c.soc_pct,
                    soh: cd.soh ?? c.soh,
                    temp_c: cd.temp_c ?? c.temp_c,
                    wind_mps: cd.wind_mps ?? c.wind_mps,
                    surplus: cd.surplus ?? 0,
                    deficit: cd.deficit ?? 0,
                    status: (cd.surplus > 0.5 ? 'surplus' : cd.deficit > 0.5 ? 'deficit' : 'balanced')
                };
            });
        }
        return cities;
    }, [cities, simHour, simData]);

    const displayOpt = useMemo(() => {
        if (simHour !== null && simData?.[simHour]) {
            const h = simData[simHour];
            const iaroa = { per_city: {}, total_cost_inr: h.totals?.iaroa_cost ?? 0, total_carbon_kg: h.totals?.iaroa_carbon ?? 0, total_time_ms: 0 };
            const mpc = { per_city: {}, total_cost_inr: h.totals?.mpc_cost ?? 0, total_carbon_kg: h.totals?.mpc_carbon ?? 0, total_time_ms: h.totals?.total_ms ?? 0 };
            Object.entries(h.cities || {}).forEach(([cid, cd]) => {
                iaroa.per_city[cid] = { city: CITY_META[cid]?.name || cid, cost_inr: cd.iaroa_cost ?? 0, carbon_kg: cd.iaroa_carbon ?? 0, import_kw: cd.import_kw ?? 0, export_kw: cd.export_kw ?? 0, time_ms: cd.iaroa_ms ?? 0 };
                mpc.per_city[cid] = { city: CITY_META[cid]?.name || cid, cost_inr: cd.mpc_cost ?? 0, carbon_kg: cd.mpc_carbon ?? 0, import_kw: cd.import_kw ?? 0, export_kw: cd.export_kw ?? 0, time_ms: cd.mpc_ms ?? 0 };
            });
            const cs = iaroa.total_cost_inr - mpc.total_cost_inr;
            return {
                iaroa,
                mpc,
                comparison: { cost_saving_inr: cs, verdict: mpc.total_cost_inr <= iaroa.total_cost_inr ? 'IAROA+MPC' : 'IAROA-Only' },
                hierarchical_mpc: h.hierarchical || { local: {}, regional: h.regional || {}, global: h.global || {} },
                performance: { per_city: h.performance || {}, total_wall_ms: h.totals?.total_ms ?? 0 }
            };
        }
        return optResult;
    }, [optResult, simHour, simData]);

    const tabs = [{ k: 'map', l: '🗺️ Network Map' }, { k: 'weather', l: '🌦️ Weather' }, { k: 'battery', l: '🔋 Battery Health' }, { k: 'hierarchy', l: '🏗️ Hierarchy MPC' }, { k: 'perf', l: '⚡ Performance' }];

    return (
        <div style={{ minHeight: '100vh', background: '#f0f4f8', fontFamily: '"DM Sans","Segoe UI",sans-serif', padding: '0 0 40px' }}>
            {showSettings && <SettingsModal settings={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} saving={savingSettings} />}

            {/* ── Header ── */}
            <div style={{ background: 'linear-gradient(135deg,#1e3a8a 0%,#1e40af 50%,#2563eb 100%)', color: 'white', padding: '18px 24px', boxShadow: '0 4px 24px rgba(37,99,235,.3)' }}>
                <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                            ⚡ 9-City Hierarchical Microgrid Network
                        </h1>
                        <p style={{ margin: '3px 0 0', fontSize: '0.78rem', opacity: .8 }}>
                            Decentralised IAROA + 3-Layer MPC · Real Weather · SOH Battery Degradation
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        {simData && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.15)', borderRadius: 24, padding: '6px 14px', backdropFilter: 'blur(8px)' }}>
                                <button onClick={() => setPlaying(p => !p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white', display: 'flex', padding: 0 }}>
                                    {playing ? '⏸' : '▶'}
                                </button>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>H{simHour?.toString().padStart(2, '0')}:00</span>
                                <input type="range" min={0} max={23} value={simHour ?? 0} onChange={e => { setSimHour(+e.target.value); setPlaying(false) }} style={{ width: 90 }} />
                                <button onClick={() => { setSimData(null); setSimHour(null); setPlaying(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white', opacity: .7 }}>✕</button>
                            </div>
                        )}
                        {/* Date pickers */}
                        <div style={{ background: 'rgba(255,255,255,.15)', borderRadius: 10, padding: '6px 12px', backdropFilter: 'blur(8px)', display: 'flex', gap: 10, alignItems: 'center' }}>
                            <label style={{ fontSize: '0.68rem', opacity: .7 }}>Start</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' }} />
                            <label style={{ fontSize: '0.68rem', opacity: .7 }}>End</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' }} />
                        </div>
                        <button onClick={runOpt} disabled={running || simRunning} style={{ padding: '8px 16px', background: running ? '#93c5fd' : '#fff', color: running ? 'white' : '#2563eb', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                            {running ? '⏳ Running...' : '⚡ Optimize Now'}
                        </button>
                        <button onClick={runSim} disabled={running || simRunning} style={{ padding: '8px 16px', background: 'rgba(255,255,255,.15)', color: 'white', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', backdropFilter: 'blur(4px)' }}>
                            {simRunning ? '⏳ Loading...' : '📊 24h Sim'}
                        </button>
                        <button onClick={() => setShowSettings(true)} style={{ padding: '8px', background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)', borderRadius: 8, cursor: 'pointer', color: 'white', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center' }}>
                            ⚙️
                        </button>
                        <button onClick={resetStates} title="Reset All States" style={{ padding: '8px', background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, cursor: 'pointer', color: '#fecaca', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center' }}>
                            🔄
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1400, margin: '20px auto', padding: '0 16px' }}>
                {/* ── Formula Panel ── */}
                <FormulaBox settings={settings} />

                {/* ── Network Summary Cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(100px,1fr))', gap: 10, marginBottom: 20 }}>
                    {displayCities.map(c => (
                        <div key={c.id} onClick={() => { setSelectedCity(c.id === selectedCity ? null : c.id); setActiveTab('map') }} style={{ background: 'white', borderRadius: 10, padding: '10px 12px', border: `2px solid ${c.id === selectedCity ? statusColor(c.status) : '#e2e8f0'}`, cursor: 'pointer', transition: 'all .15s', boxShadow: c.id === selectedCity ? `0 0 0 3px ${statusColor(c.status)}33` : '0 1px 4px rgba(0,0,0,.04)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(c.status), display: 'block' }} />
                                <span style={{ fontWeight: 700, fontSize: '0.78rem', color: '#1e293b' }}>{c.name}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '0.58rem', color: CLUSTER_COL[c.cluster], background: `${CLUSTER_COL[c.cluster]}18`, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{c.cluster.slice(0, 1).toUpperCase()}</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <span>☀️ {c.pv_now}</span><span>💨 {c.wind_now}</span>
                                <span>⚡ {c.load_now}</span><span>🔋 {c.soc_pct}%</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: statusColor(c.status), marginTop: 3 }}>
                                {c.net_kw > 0 ? `+${c.net_kw}` : c.net_kw} kW
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Main Content Area ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16, marginBottom: 20 }}>
                    {/* Left: Tab content */}
                    <div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                            {tabs.map(t => (
                                <button key={t.k} onClick={() => setActiveTab(t.k)} style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', background: activeTab === t.k ? '#2563eb' : 'white', color: activeTab === t.k ? 'white' : '#64748b', boxShadow: activeTab === t.k ? '0 2px 8px rgba(37,99,235,.25)' : '0 1px 3px rgba(0,0,0,.08)' }}>
                                    {t.l}
                                </button>
                            ))}
                        </div>

                        {/* MAP TAB */}
                        {activeTab === 'map' && (
                            <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
                                <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 8, fontSize: '0.9rem' }}>🗺️ Network Topology — 9 Cities, 3 Clusters</div>
                                <svg viewBox="50 30 340 390" style={{ width: '100%', maxHeight: 380 }}>
                                    <defs>
                                        <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                                    </defs>
                                    <path d={INDIA_PATH} fill="rgba(37,99,235,.05)" stroke="rgba(37,99,235,.3)" strokeWidth="1.2" strokeLinejoin="round" />
                                    {/* cluster hulls */}
                                    {Object.entries(CLUSTERS).map(([cl, members]) => {
                                        const pts = members.map(c => MAP_POS[c]).filter(Boolean);
                                        if (pts.length < 2) return null;
                                        const minX = Math.min(...pts.map(p => p.x)) - 18, maxX = Math.max(...pts.map(p => p.x)) + 18;
                                        const minY = Math.min(...pts.map(p => p.y)) - 18, maxY = Math.max(...pts.map(p => p.y)) + 18;
                                        return <rect key={cl} x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={12} fill={`${CLUSTER_COL[cl]}12`} stroke={CLUSTER_COL[cl]} strokeWidth="1" strokeDasharray="4 3" opacity=".7" />;
                                    })}
                                    {/* comm links (all pairs within each cluster) */}
                                    {Object.entries(CLUSTERS).flatMap(([cl, members]) => {
                                        const pairs = [];
                                        for (let i = 0; i < members.length; i++)for (let j = i + 1; j < members.length; j++)pairs.push([members[i], members[j], cl]);
                                        return pairs;
                                    }).map(([a, b, cl], i) => {
                                        const fa = MAP_POS[a], fb = MAP_POS[b];
                                        if (!fa || !fb) return null;
                                        return <line key={i} x1={fa.x} y1={fa.y} x2={fb.x} y2={fb.y} stroke={CLUSTER_COL[cl]} strokeWidth="1" strokeDasharray="5 4" strokeDashoffset={animPhase} opacity=".5" />;
                                    })}
                                    {/* cross-cluster links (between cluster centroids) */}
                                    {[['north', 'west'], ['north', 'south'], ['west', 'south']].map(([c1, c2], i) => {
                                        const m1 = CLUSTERS[c1];
                                        const m2 = CLUSTERS[c2];
                                        const avg = (ms) => ({ x: ms.reduce((s, c) => s + (MAP_POS[c]?.x ?? 0), 0) / ms.length, y: ms.reduce((s, c) => s + (MAP_POS[c]?.y ?? 0), 0) / ms.length });
                                        const p1 = avg(m1), p2 = avg(m2);
                                        return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#94a3b8" strokeWidth="0.7" strokeDasharray="3 6" opacity=".4" />;
                                    })}
                                    {/* City nodes */}
                                    {displayCities.map(city => {
                                        const pos = MAP_POS[city.id]; if (!pos) return null;
                                        const sc = statusColor(city.status);
                                        const sel = selectedCity === city.id;
                                        const pulse = 16 + 3 * Math.sin((animPhase + city.id.charCodeAt(0) * 40) * Math.PI / 180);
                                        return (
                                            <g key={city.id} onClick={() => { setSelectedCity(city.id === selectedCity ? null : city.id) }} style={{ cursor: 'pointer' }}>
                                                <circle cx={pos.x} cy={pos.y} r={pulse} fill="none" stroke={sc} strokeWidth=".8" opacity=".25" />
                                                <circle cx={pos.x} cy={pos.y} r={sel ? 13 : 10} fill={`${sc}22`} stroke={sc} strokeWidth={sel ? 2.5 : 1.5} filter="url(#glow)" />
                                                <circle cx={pos.x} cy={pos.y} r={4} fill={sc} />
                                                <text x={pos.x} y={pos.y - 20} textAnchor="middle" fill="#1e293b" fontSize="10" fontWeight="600">{city.name}</text>
                                                <text x={pos.x} y={pos.y + 26} textAnchor="middle" fill={sc} fontSize="8" fontWeight="600">
                                                    {city.net_kw > 0 ? '+' : ''}{city.net_kw}kW
                                                </text>
                                            </g>
                                        );
                                    })}
                                </svg>
                                {/* Cluster legend */}
                                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
                                    {Object.entries(CLUSTER_COL).map(([cl, col]) => (
                                        <span key={cl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#475569' }}>
                                            <span style={{ width: 12, height: 12, background: col, borderRadius: 3, display: 'block' }} />
                                            {cl.charAt(0).toUpperCase() + cl.slice(1)} Cluster
                                        </span>
                                    ))}
                                    {[{ l: 'Surplus', c: C.surplus }, { l: 'Deficit', c: C.deficit }, { l: 'Balanced', c: C.balanced }].map(x => (
                                        <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: '#475569' }}>
                                            <span style={{ width: 8, height: 8, background: x.c, borderRadius: '50%', display: 'block' }} />
                                            {x.l}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* WEATHER TAB */}
                        {activeTab === 'weather' && (
                            <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
                                <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 12, fontSize: '0.9rem' }}>🌦️ City Weather — Historical &amp; Forecast</div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                                    {displayCities.map(c => (
                                        <button key={c.id} onClick={() => setSelectedCity(c.id === selectedCity ? null : c.id)} style={{ padding: '4px 12px', borderRadius: 20, border: `2px solid ${c.id === selectedCity ? '#2563eb' : '#e2e8f0'}`, background: c.id === selectedCity ? '#eff6ff' : 'white', color: c.id === selectedCity ? '#1d4ed8' : '#64748b', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}>
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                                <WeatherPanel cityId={selectedCity} startDate={startDate} endDate={endDate} />
                            </div>
                        )}

                        {/* BATTERY TAB */}
                        {activeTab === 'battery' && <BatteryHealthPanel cities={displayCities} />}

                        {/* HIERARCHY TAB */}
                        {activeTab === 'hierarchy' && <HierarchyPanel hData={displayOpt?.hierarchical_mpc} />}

                        {/* PERFORMANCE TAB */}
                        {activeTab === 'perf' && <PerfMetrics perf={displayOpt?.performance?.per_city || optResult?.performance?.per_city} totalMs={displayOpt?.performance?.total_wall_ms || optResult?.performance?.total_wall_ms} />}
                    </div>

                    {/* Right: City Detail */}
                    <div style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)', minHeight: 400 }}>
                        {selectedCity && displayCities.find(c => c.id === selectedCity) ? (() => {
                            const c = displayCities.find(c => c.id === selectedCity);
                            const ic = displayOpt?.iaroa?.per_city?.[selectedCity];
                            const mc = displayOpt?.mpc?.per_city?.[selectedCity];
                            const sc = statusColor(c.status);
                            return (
                                <div>
                                    <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e293b', marginBottom: 4 }}>{c.name}</div>
                                    <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                                        <span style={{ padding: '3px 10px', borderRadius: 12, background: `${sc}15`, color: sc, fontWeight: 700, fontSize: '0.72rem', border: `1px solid ${sc}40` }}>
                                            {c.status === 'surplus' ? '☀️ Surplus' : c.status === 'deficit' ? '⚡ Deficit' : '⚖️ Balanced'}
                                        </span>
                                        <span style={{ padding: '3px 10px', borderRadius: 12, background: `${CLUSTER_COL[c.cluster]}15`, color: CLUSTER_COL[c.cluster], fontWeight: 700, fontSize: '0.72rem' }}>
                                            {c.cluster.toUpperCase()} cluster
                                        </span>
                                    </div>
                                    {/* Energy grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                                        {[{ l: 'Solar PV', v: `${c.pv_now} kW`, icon: '☀️', col: '#f59e0b' }, { l: 'Wind', v: `${c.wind_now} kW`, icon: '💨', col: '#3b82f6' }, { l: 'Thermal', v: `${c.thermal_now} kW`, icon: '🔥', col: '#ef4444' }, { l: 'Load', v: `${c.load_now} kW`, icon: '🏘️', col: '#6366f1' }, { l: 'Net Power', v: `${c.net_kw > 0 ? '+' : ''}${c.net_kw} kW`, icon: '⚡', col: sc }, { l: 'Temp/Wind', v: `${c.temp_c}°C / ${c.wind_mps}m/s`, icon: '🌡️', col: '#06b6d4' }].map(m => (
                                            <div key={m.l} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', borderLeft: `3px solid ${m.col}` }}>
                                                <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 2 }}>{m.icon} {m.l}</div>
                                                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: m.col }}>{m.v}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Battery */}
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b', marginBottom: 4 }}>
                                            <span>🔋 Battery SOC</span><span>{c.soc_pct}% ({c.soc_kwh} kWh)</span>
                                        </div>
                                        <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
                                            <div style={{ height: '100%', width: `${c.soc_pct}%`, background: c.soc_pct > 60 ? 'linear-gradient(90deg,#22c55e,#4ade80)' : c.soc_pct > 30 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#ef4444,#f87171)', borderRadius: 4, transition: 'width .5s' }} />
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                                            <span>SOH: {((c.soh ?? 1) * 100).toFixed(2)}%</span>
                                            <span>Cap: {c.bat_cap} kWh</span>
                                        </div>
                                    </div>
                                    {/* Opt comparison */}
                                    {ic && mc && (
                                        <div>
                                            <div style={{ fontWeight: 700, color: '#475569', fontSize: '0.78rem', marginBottom: 6 }}>Optimization Results</div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem' }}>
                                                <thead><tr style={{ background: '#f8fafc' }}><th style={{ padding: '5px 8px', textAlign: 'left', color: '#94a3b8' }}>Metric</th><th style={{ padding: '5px 8px', color: C.iaroa }}>IAROA</th><th style={{ padding: '5px 8px', color: C.mpc }}>+MPC</th></tr></thead>
                                                <tbody>
                                                    {[['Hourly Cost', 'cost_inr', '₹'], ['Carbon Emission', 'carbon_kg', 'kg'], ['Grid Import', 'import_kw', 'kW'], ['Bat. Charge', 'charge_kw', 'kW'], ['Bat. Discharge', 'discharge_kw', 'kW']].map(([l, k, u]) => (
                                                        <tr key={l} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                            <td style={{ padding: '5px 8px', color: '#64748b' }}>{l}</td>
                                                            <td style={{ padding: '5px 8px', fontWeight: 600 }}>{u}{ic[k]}</td>
                                                            <td style={{ padding: '5px 8px', fontWeight: 600, color: mc[k] <= ic[k] ? '#22c55e' : '#ef4444' }}>{u}{mc[k]}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            );
                        })() : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#94a3b8', fontSize: '0.85rem', gap: 10 }}>
                                <span style={{ fontSize: 40 }}>🗺️</span>
                                <span>Click a city card or map node to view details</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Opt Comparison Dashboard ── */}
                {displayOpt && (
                    <div style={{ background: 'white', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,.06)', marginBottom: 20 }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                            📊 Algorithm Comparison: IAROA vs IAROA+MPC
                            <span style={{ padding: '3px 12px', borderRadius: 12, background: displayOpt.comparison?.verdict === 'IAROA+MPC' ? '#d1fae5' : '#fef9c3', color: displayOpt.comparison?.verdict === 'IAROA+MPC' ? '#065f46' : '#92400e', fontWeight: 700, fontSize: '0.72rem' }}>
                                🏆 {displayOpt.comparison?.verdict}
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
                            {[
                                { l: 'IAROA Total Cost', v: `₹${fmt(displayOpt.iaroa?.total_cost_inr)}`, col: C.iaroa },
                                { l: 'MPC Total Cost', v: `₹${fmt(displayOpt.mpc?.total_cost_inr)}`, col: C.mpc },
                                { l: 'IAROA Carbon', v: `${fmt(displayOpt.iaroa?.total_carbon_kg)} kg`, col: '#ef4444' },
                                { l: 'MPC Carbon', v: `${fmt(displayOpt.mpc?.total_carbon_kg)} kg`, col: '#7c3aed' },
                            ].map((m, i) => (
                                <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', borderTop: `3px solid ${m.col}` }}>
                                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 4 }}>{m.l}</div>
                                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: m.col }}>{m.v}</div>
                                </div>
                            ))}
                        </div>
                        {/* Per-city table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                        <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>City</th>
                                        <th style={{ padding: '8px 10px', color: C.iaroa, borderBottom: '1px solid #e2e8f0' }}>IAROA Cost</th>
                                        <th style={{ padding: '8px 10px', color: C.mpc, borderBottom: '1px solid #e2e8f0' }}>MPC Cost</th>
                                        <th style={{ padding: '8px 10px', color: '#ef4444', borderBottom: '1px solid #e2e8f0' }}>IAROA CO₂</th>
                                        <th style={{ padding: '8px 10px', color: '#7c3aed', borderBottom: '1px solid #e2e8f0' }}>MPC CO₂</th>
                                        <th style={{ padding: '8px 10px', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Import kW</th>
                                        <th style={{ padding: '8px 10px', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>Time ms</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(displayOpt.iaroa?.per_city || {}).map(([cid, ic]) => {
                                        const mc = displayOpt.mpc?.per_city?.[cid];
                                        return (
                                            <tr key={cid} onClick={() => setSelectedCity(cid)} style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: selectedCity === cid ? '#eff6ff' : 'white' }}>
                                                <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e293b' }}>{ic.city}</td>
                                                <td style={{ padding: '7px 10px' }}>₹{ic.cost_inr}</td>
                                                <td style={{ padding: '7px 10px', color: mc?.cost_inr <= ic.cost_inr ? '#22c55e' : '#ef4444', fontWeight: 600 }}>₹{mc?.cost_inr}</td>
                                                <td style={{ padding: '7px 10px' }}>{ic.carbon_kg}</td>
                                                <td style={{ padding: '7px 10px', color: mc?.carbon_kg <= ic.carbon_kg ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{mc?.carbon_kg}</td>
                                                <td style={{ padding: '7px 10px' }}>{mc?.import_kw}</td>
                                                <td style={{ padding: '7px 10px', color: '#6366f1', fontWeight: 600 }}>{ic.time_ms}ms</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── Battery Health Panel (always visible) ── */}
                <div style={{ marginBottom: 20 }}>
                    <BatteryHealthPanel cities={displayCities} />
                </div>

                {/* ── 24h Sim Report ── */}
                {simData && !playing && <SimReport simData={simData} date={startDate} />}
            </div>
        </div>
    );
}
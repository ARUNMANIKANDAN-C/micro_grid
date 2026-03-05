import { useState, useEffect } from 'react';
import {
  Zap, Battery, BatteryCharging,
  ArrowRightLeft, Sun, Building, DollarSign, Clock, Leaf, Settings, Network
} from 'lucide-react';
import './index.css';
import DecentralizedView from './DecentralizedView';

function App() {
  const [activeTab, setActiveTab] = useState('single');
  // Input States
  const [soc, setSoc] = useState(25.0);
  const [pv, setPv] = useState(4.5);
  const [load, setLoad] = useState(8.0);
  const [importPrice, setImportPrice] = useState(8);
  const [ecoWeight, setEcoWeight] = useState(0.0);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Output Action State
  const [action, setAction] = useState({
    importKw: 0,
    exportKw: 0,
    chargeKw: 0,
    dischargeKw: 0,
    loadSheddingActive: false,
    servedLoadKw: load,
    cost: 0,
    loading: false,
    error: null
  });

  // Live API Data
  const [liveData, setLiveData] = useState({
    pvForecast: null,
    pvSource: 'loading',
    carbonIntensity: 700,
    carbonSource: 'loading',
    carbonZone: 'IN-WE'
  });

  // Settings Panel
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    solcast_api_key: '', solcast_site_id: '',
    electricitymaps_api_key: '', electricitymaps_zone: 'IN-WE',
    pv_capacity_kw: 10.0
  });
  const [settingsStatus, setSettingsStatus] = useState({ solcast_configured: false, carbon_configured: false, message: '' });

  // Load current settings from backend on mount
  useEffect(() => {
    fetch('http://localhost:8001/settings')
      .then(r => r.json())
      .then(data => setSettingsStatus(data))
      .catch(() => { });
  }, []);

  const saveSettings = async () => {
    try {
      const res = await fetch('http://localhost:8001/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm)
      });
      const data = await res.json();
      setSettingsStatus(data);
      setSettingsForm({ solcast_api_key: '', solcast_site_id: '', electricitymaps_api_key: '', electricitymaps_zone: data.electricitymaps_zone || 'IN-WE', pv_capacity_kw: data.pv_capacity_kw || 10.0 });
      // Re-fetch live data with new keys
      fetchLiveData();
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  };

  // Fetch live forecast + carbon from backend proxy (every 30 min)
  const fetchLiveData = async () => {
    try {
      const [fcRes, carbonRes] = await Promise.all([
        fetch('http://localhost:8001/forecast'),
        fetch('http://localhost:8001/carbon')
      ]);
      const fcData = await fcRes.json();
      const carbonData = await carbonRes.json();
      setLiveData({
        pvForecast: fcData.pv_forecast_24h,
        pvSource: fcData.source,
        carbonIntensity: carbonData.carbon_intensity_gco2_kwh,
        carbonSource: carbonData.source,
        carbonZone: carbonData.zone
      });
    } catch (e) {
      console.warn('Live data fetch failed, using defaults', e);
    }
  };

  useEffect(() => {
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch optimal action from API
  const computeOptimization = async () => {
    setAction(prev => ({ ...prev, loading: true, error: null }));

    // Build REALISTIC time-varying 24h forecasts starting from the CURRENT hour.
    const currentHour = new Date().getHours();

    // PV: Use live Solcast data if available, otherwise use bell curve
    let mockPv24h;
    if (liveData.pvForecast && liveData.pvForecast.length >= 24) {
      // Rotate the live Solcast forecast to start from current hour
      const rotate = (arr, n) => [...arr.slice(n), ...arr.slice(0, n)];
      mockPv24h = rotate(liveData.pvForecast, currentHour);
    } else {
      const pvBase = [0.0, 0.0, 0.0, 0.01, 0.05, 0.15, 0.35, 0.60, 0.82, 0.95, 1.0, 1.0, 0.95, 0.82, 0.60, 0.35, 0.15, 0.05, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0];
      const rotate = (arr, n) => [...arr.slice(n), ...arr.slice(0, n)];
      mockPv24h = rotate(pvBase, currentHour).map(f => parseFloat((pv * f).toFixed(2)));
    }

    // Load + Pricing: use base profiles scaled by sliders, rotated to current hour
    const loadBase = [0.12, 0.12, 0.12, 0.15, 0.25, 0.38, 0.55, 0.75, 0.88, 0.94, 1.0, 1.0, 0.94, 0.88, 0.80, 0.70, 0.60, 0.50, 0.42, 0.35, 0.25, 0.18, 0.15, 0.12];
    const priceBase = [0.40, 0.40, 0.40, 0.40, 0.45, 0.55, 0.70, 0.80, 0.90, 0.95, 1.0, 1.0, 0.95, 0.85, 0.75, 0.65, 0.75, 0.90, 1.0, 0.80, 0.60, 0.50, 0.45, 0.40];
    const rotateArr = (arr, n) => [...arr.slice(n), ...arr.slice(0, n)];
    const mockLoad24h = rotateArr(loadBase, currentHour).map(f => parseFloat((load * f).toFixed(2)));
    const mockImpPrice24h = rotateArr(priceBase, currentHour).map(f => parseFloat((importPrice * f).toFixed(1)));
    const mockExpPrice24h = mockImpPrice24h.map(p => parseFloat((p * 0.5).toFixed(1)));

    try {
      const response = await fetch('http://localhost:8001/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_soc_kwh: soc,
          pv_forecast_24h: mockPv24h,
          load_forecast_24h: mockLoad24h,
          import_price_24h: mockImpPrice24h,
          export_price_24h: mockExpPrice24h,
          eco_weight: ecoWeight,
          current_carbon_intensity: liveData.carbonIntensity
        })
      });

      if (!response.ok) throw new Error('API Request Failed');
      const data = await response.json();

      // Legacy fallback: if the response is in the new decentralized format, map Delhi's data (default single city)
      const legacyData = data.mpc?.per_city?.delhi ? {
        action_p_import_kw: data.mpc.per_city.delhi.import_kw,
        action_p_export_kw: data.mpc.per_city.delhi.export_kw,
        action_bat_charge_kw: data.mpc.per_city.delhi.charge_kw,
        action_bat_discharge_kw: data.mpc.per_city.delhi.discharge_kw,
        action_load_shedding_active: data.city_opt?.delhi?.load_now > data.city_opt?.delhi?.gen_now + 10, // heuristic
        action_served_load_kw: data.city_opt?.delhi?.load_now ?? load,
        predicted_operational_cost: data.mpc.total_cost_inr
      } : data;

      setAction({
        importKw: legacyData.action_p_import_kw ?? 0,
        exportKw: legacyData.action_p_export_kw ?? 0,
        chargeKw: legacyData.action_bat_charge_kw ?? 0,
        dischargeKw: legacyData.action_bat_discharge_kw ?? 0,
        loadSheddingActive: !!legacyData.action_load_shedding_active,
        servedLoadKw: legacyData.action_served_load_kw ?? load,
        cost: legacyData.predicted_operational_cost ?? 0,
        loading: false,
        error: null
      });
    } catch (error) {
      console.error(error);
      setAction(prev => ({ ...prev, loading: false, error: 'Failed to connect to Optimization Engine' }));
    }
  };

  // Auto-recalculate when sliders debounced
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      computeOptimization();
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [soc, pv, load, importPrice, ecoWeight, liveData.carbonIntensity]);

  return (
    <div className="dashboard">
      {/* === TAB NAVIGATION === */}
      <div className="tab-navigation">
        <button
          className={`tab-btn ${activeTab === 'single' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('single')}
        >
          <Zap size={16} /> Single Microgrid
        </button>
        <button
          className={`tab-btn ${activeTab === 'decentralized' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('decentralized')}
        >
          <Network size={16} /> Decentralized 5-City
        </button>
      </div>

      {activeTab === 'decentralized' ? (
        <DecentralizedView />
      ) : (
        <>
          <header>
            <h1>Microgrid Control Hub</h1>
            <p>Real-Time Distributed Energy Resource (DER) Optimization</p>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem', marginTop: '0.75rem', padding: '0.5rem 1.2rem',
              background: 'rgba(59, 130, 246, 0.15)', borderRadius: '12px',
              border: '1px solid rgba(59, 130, 246, 0.3)', width: 'fit-content',
              margin: '0.75rem auto 0'
            }}>
              <Clock size={18} color="var(--accent-blue)" />
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', letterSpacing: '0.05em' }}>
                {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                MPC Horizon Hour: <strong style={{ color: 'var(--accent-orange)' }}>{currentTime.getHours()}:00</strong>
              </span>
            </div>
          </header>

          {/* === API SETTINGS PANEL === */}
          <div style={{ maxWidth: '1200px', margin: '0 auto 1rem', padding: '0 1rem' }}>
            <button onClick={() => setShowSettings(!showSettings)} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem',
              background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem',
              width: '100%', justifyContent: 'space-between'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Settings size={16} /> API Configuration
              </span>
              <span style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
                <span style={{ color: settingsStatus.solcast_configured ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {settingsStatus.solcast_configured ? '🟢 Solcast Live' : '🟡 Solcast: Mock'}
                </span>
                <span style={{ color: settingsStatus.carbon_configured ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                  {settingsStatus.carbon_configured ? '🟢 Carbon Live' : '🟡 Carbon: Mock'}
                </span>
                <span>{showSettings ? '▲ Close' : '▼ Configure'}</span>
              </span>
            </button>

            {showSettings && (
              <div style={{
                marginTop: '0.75rem', padding: '1.5rem', background: 'rgba(15, 23, 42, 0.8)',
                borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(12px)'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* Solcast Column */}
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: 'var(--accent-orange)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Sun size={16} /> Solcast PV Forecast
                    </h3>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>API Key</label>
                      <input type="password" placeholder={settingsStatus.solcast_configured ? '****configured****' : 'Enter Solcast API Key'}
                        value={settingsForm.solcast_api_key}
                        onChange={e => setSettingsForm(p => ({ ...p, solcast_api_key: e.target.value }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
                      />
                    </div>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Site ID</label>
                      <input type="text" placeholder={settingsStatus.solcast_site_id || 'e.g. xxxx-xxxx-xxxx-xxxx'}
                        value={settingsForm.solcast_site_id}
                        onChange={e => setSettingsForm(p => ({ ...p, solcast_site_id: e.target.value }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>PV Capacity (kW)</label>
                      <input type="number" value={settingsForm.pv_capacity_kw} min="0.1" step="0.5"
                        onChange={e => setSettingsForm(p => ({ ...p, pv_capacity_kw: parseFloat(e.target.value) || 10 }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
                      />
                    </div>
                  </div>

                  {/* ElectricityMaps Column */}
                  <div>
                    <h3 style={{ fontSize: '0.95rem', color: 'var(--accent-green)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Leaf size={16} /> Electricity Maps Carbon
                    </h3>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Auth Token</label>
                      <input type="password" placeholder={settingsStatus.carbon_configured ? '****configured****' : 'Enter ElectricityMaps Auth Token'}
                        value={settingsForm.electricitymaps_api_key}
                        onChange={e => setSettingsForm(p => ({ ...p, electricitymaps_api_key: e.target.value }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
                      />
                    </div>
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Grid Zone</label>
                      <select value={settingsForm.electricitymaps_zone}
                        onChange={e => setSettingsForm(p => ({ ...p, electricitymaps_zone: e.target.value }))}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}>
                        <option value="IN-WE">IN-WE (Western India)</option>
                        <option value="IN-NO">IN-NO (Northern India)</option>
                        <option value="IN-SO">IN-SO (Southern India)</option>
                        <option value="IN-EA">IN-EA (Eastern India)</option>
                        <option value="IN-NE">IN-NE (Northeast India)</option>
                      </select>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1rem', lineHeight: '1.5' }}>
                      Get free API keys:<br />
                      • <a href="https://toolkit.solcast.com.au" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>Solcast Free Rooftop</a> (10 API calls/day)<br />
                      • <a href="https://www.electricitymaps.com/free-tier-api" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)' }}>Electricity Maps Free Tier</a>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <button onClick={saveSettings} style={{
                    padding: '0.6rem 2rem', background: 'linear-gradient(135deg, var(--accent-green), var(--accent-blue))',
                    border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem'
                  }}>💾 Save & Connect</button>
                  {settingsStatus.message && <span style={{ fontSize: '0.8rem', color: 'var(--accent-green)', alignSelf: 'center' }}>✅ {settingsStatus.message}</span>}
                </div>
              </div>
            )}
          </div>

          <div className="grid-layout">

            {/* Left Column: Interactive Physical Inputs */}
            <section className="glass-panel">
              <div className="panel-title">
                <Zap size={24} color="var(--accent-blue)" />
                Physical State Parameters
              </div>

              <div className="input-group">
                <div className="input-header">
                  <span className="input-label"><Battery size={16} style={{ display: 'inline', marginRight: '4px' }} />Battery State of Charge</span>
                  <span className="input-value">{soc} kWh</span>
                </div>
                <input
                  type="range" min="9.5" max="42.6" step="0.1"
                  value={soc} onChange={(e) => setSoc(parseFloat(e.target.value))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-muted)' }}>
                  <span>Min Bound (9.5)</span><span>Max Bound (42.6)</span>
                </div>
              </div>

              <div className="input-group">
                <div className="input-header">
                  <span className="input-label"><Sun size={16} style={{ display: 'inline', marginRight: '4px' }} />Solar PV Generation</span>
                  <span className="input-value">{pv} kW</span>
                </div>
                <input
                  type="range" min="0" max="10" step="0.1"
                  value={pv} onChange={(e) => setPv(parseFloat(e.target.value))}
                />
              </div>

              <div className="input-group">
                <div className="input-header">
                  <span className="input-label"><Building size={16} style={{ display: 'inline', marginRight: '4px' }} />Facility Load Demand</span>
                  <span className="input-value">{load} kW</span>
                </div>
                <input
                  type="range" min="0" max="25" step="0.5"
                  value={load} onChange={(e) => setLoad(parseFloat(e.target.value))}
                />
              </div>

              <div className="input-group">
                <div className="input-header">
                  <span className="input-label"><DollarSign size={16} style={{ display: 'inline', marginRight: '4px' }} />Grid Import Price</span>
                  <span className="input-value">{importPrice} ₹/kWh</span>
                </div>
                <input
                  type="range" min="2" max="20" step="0.5"
                  value={importPrice} onChange={(e) => setImportPrice(parseFloat(e.target.value))}
                />
              </div>

              <div className="input-group">
                <div className="input-header" style={{ marginBottom: '8px' }}>
                  <span className="input-label"><Leaf size={16} style={{ display: 'inline', marginRight: '4px', color: 'var(--accent-green)' }} />Optimizer Objective (Greed vs Green)</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05"
                  value={ecoWeight} onChange={(e) => setEcoWeight(parseFloat(e.target.value))}
                  style={{
                    background: `linear-gradient(90deg, var(--text-muted) 0%, var(--accent-green) 100%)`
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginTop: '6px' }}>
                  <span style={{ color: ecoWeight < 0.3 ? 'var(--text-main)' : 'var(--text-muted)' }}>💲 Max Profit (0.0)</span>
                  <span style={{ color: ecoWeight > 0.7 ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: ecoWeight > 0.7 ? 600 : 400 }}>🌿 Min Carbon (1.0)</span>
                </div>
              </div>

              <button className="btn-compute" onClick={computeOptimization}>
                {action.loading ? 'Calculating Trajectory...' : 'Force Re-Optimize'}
              </button>
              {action.error && <p style={{ color: 'var(--accent-red)', marginTop: '10px', fontSize: '0.9rem', textAlign: 'center' }}>{action.error}</p>}
            </section>

            {/* Right Column: MPC Dispatch Output Constraints */}
            <section className="glass-panel">
              <div className="panel-title" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowRightLeft size={24} color="var(--accent-green)" />
                  Optimal Dispatch Commands
                </div>
                {action.loading ? (
                  <span className="status-badge" style={{ color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)' }}>Computing...</span>
                ) : (
                  <span className="status-badge">Locked & Active</span>
                )}
              </div>

              {/* Load Priority Status Bar */}
              <div style={{
                marginTop: '1.2rem', marginBottom: '1.5rem', padding: '1rem', borderRadius: '12px',
                background: action.loadSheddingActive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                border: `1px solid ${action.loadSheddingActive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Building size={24} color={action.loadSheddingActive ? 'var(--accent-red)' : 'var(--accent-green)'} />
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: action.loadSheddingActive ? 'var(--accent-red)' : 'var(--text-main)' }}>
                      {action.loadSheddingActive ? '⚠️ Eco-DR Shedding Active' : '✅ Normal Operation'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {action.loadSheddingActive
                        ? `Flexible loads curtailed due to high carbon/price penalties.`
                        : `100% of facility load is being served.`}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: action.loadSheddingActive ? 'var(--accent-orange)' : 'var(--text-main)' }}>
                    {(action.servedLoadKw ?? 0).toFixed(1)} <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>/ {(load ?? 0).toFixed(1)} kW</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Load Served</div>
                </div>
              </div>

              <div className="kpi-grid">
                <div className="kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-title">Grid Import</span>
                    <ArrowRightLeft size={20} className="kpi-import" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span className={`kpi-value kpi-import`}>{(action.importKw ?? 0).toFixed(2)}</span>
                    <span className="kpi-unit">kW</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-title">Grid Export</span>
                    <Zap size={20} className="kpi-export" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span className={`kpi-value kpi-export`}>{(action.exportKw ?? 0).toFixed(2)}</span>
                    <span className="kpi-unit">kW</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-title">Battery Charge</span>
                    <BatteryCharging size={20} className="kpi-charge" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span className={`kpi-value kpi-charge`}>{(action.chargeKw ?? 0).toFixed(2)}</span>
                    <span className="kpi-unit">kW</span>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-header">
                    <span className="kpi-title">Battery Discharge</span>
                    <Battery size={20} className="kpi-discharge" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span className={`kpi-value kpi-discharge`}>{(action.dischargeKw ?? 0).toFixed(2)}</span>
                    <span className="kpi-unit">kW</span>
                  </div>
                </div>
              </div>

              <div className="kpi-card" style={{ marginTop: '1.5rem', background: 'rgba(30, 41, 59, 0.4)' }}>
                <div className="kpi-header">
                  <span className="kpi-title">24h Trajectory Projected Cost</span>
                  <DollarSign size={20} color="var(--text-muted)" />
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span className="kpi-value" style={{ color: 'var(--text-main)' }}>{action.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  <span className="kpi-unit">₹</span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  MPC Rolling Horizon mathematically guaranteed minimum based on current input parameters.
                </p>
              </div>
            </section>

          </div>

          {/* === MICROGRID LIVE STATUS SECTION === */}
          {(() => {
            const h = currentTime.getHours();
            const pvBase = [0.0, 0.0, 0.0, 0.01, 0.05, 0.15, 0.35, 0.60, 0.82, 0.95, 1.0, 1.0, 0.95, 0.82, 0.60, 0.35, 0.15, 0.05, 0.01, 0.0, 0.0, 0.0, 0.0, 0.0];
            const loadBase = [0.12, 0.12, 0.12, 0.15, 0.25, 0.38, 0.55, 0.75, 0.88, 0.94, 1.0, 1.0, 0.94, 0.88, 0.80, 0.70, 0.60, 0.50, 0.42, 0.35, 0.25, 0.18, 0.15, 0.12];
            const priceBase = [0.40, 0.40, 0.40, 0.40, 0.45, 0.55, 0.70, 0.80, 0.90, 0.95, 1.0, 1.0, 0.95, 0.85, 0.75, 0.65, 0.75, 0.90, 1.0, 0.80, 0.60, 0.50, 0.45, 0.40];

            const nowPv = (parseFloat(pv || 0) * pvBase[h]).toFixed(1);
            const baseCurrentLoad = (parseFloat(load || 0) * loadBase[h]).toFixed(1);
            const nowLoad = action.loadSheddingActive ? (action.servedLoadKw || 0).toFixed(1) : baseCurrentLoad;
            const nowPrice = (parseFloat(importPrice || 0) * priceBase[h]).toFixed(1);
            const netPower = (parseFloat(nowPv) - parseFloat(nowLoad)).toFixed(1);
            const socPct = (((soc || 0) / 47.4) * 100).toFixed(0);
            const isExporting = parseFloat(netPower) > 0;
            const isBatActive = (action.chargeKw || 0) > 0.01 || (action.dischargeKw || 0) > 0.01;

            let mode = '⏸ Idle';
            let modeColor = 'var(--text-muted)';
            if (action.dischargeKw > 0.01) { mode = '🔋 Battery Discharge'; modeColor = 'var(--accent-orange)'; }
            else if (action.chargeKw > 0.01) { mode = '⚡ Battery Charging'; modeColor = 'var(--accent-green)'; }
            else if (isExporting) { mode = '☀️ Solar Export Mode'; modeColor = '#facc15'; }
            else if (action.importKw > 0.01) { mode = '🔌 Grid Import Mode'; modeColor = 'var(--accent-blue)'; }

            const socColor = socPct > 60 ? 'var(--accent-green)' : socPct > 30 ? 'var(--accent-orange)' : 'var(--accent-red)';

            return (
              <section className="glass-panel" style={{ marginTop: '1.5rem' }}>
                <div className="panel-title" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Zap size={24} color="var(--accent-orange)" />
                    Microgrid Live Status
                  </div>
                  <span className="status-badge" style={{ color: modeColor, borderColor: modeColor, fontSize: '0.85rem' }}>
                    {mode}
                  </span>
                </div>

                {/* Live Metrics Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '1rem' }}>

                  {/* Current Solar Output */}
                  <div className="kpi-card" style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <Sun size={16} color="#facc15" />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Solar Now</span>
                    </div>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, color: '#facc15' }}>{nowPv}</span>
                    <span className="kpi-unit"> kW</span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {nowPv > 0 ? '● Active' : '○ Night'}
                    </div>
                  </div>

                  {/* Current Demand */}
                  <div className="kpi-card" style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <Building size={16} color="var(--accent-blue)" />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Demand Now</span>
                    </div>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-blue)' }}>{nowLoad}</span>
                    <span className="kpi-unit"> kW</span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {nowLoad > 5 ? '▲ Peak Hours' : nowLoad > 2 ? '— Normal' : '▽ Off-Peak'}
                    </div>
                  </div>

                  {/* Net Power Flow */}
                  <div className="kpi-card" style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <ArrowRightLeft size={16} color={isExporting ? 'var(--accent-green)' : 'var(--accent-red)'} />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Net Power</span>
                    </div>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, color: isExporting ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {netPower > 0 ? '+' : ''}{netPower}
                    </span>
                    <span className="kpi-unit"> kW</span>
                    <div style={{ fontSize: '0.7rem', color: isExporting ? 'var(--accent-green)' : 'var(--accent-red)', marginTop: '4px' }}>
                      {isExporting ? '↑ Surplus → Grid' : '↓ Deficit → Import'}
                    </div>
                  </div>

                  {/* Current Tariff */}
                  <div className="kpi-card" style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <DollarSign size={16} color="var(--accent-orange)" />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tariff Now</span>
                    </div>
                    <span style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--accent-orange)' }}>₹{nowPrice}</span>
                    <span className="kpi-unit">/kWh</span>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {nowPrice > importPrice * 0.85 ? '🔴 Peak Rate' : nowPrice > importPrice * 0.55 ? '🟡 Normal' : '🟢 Off-Peak'}
                    </div>
                  </div>
                </div>

                {/* Battery Health Bar */}
                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(15, 23, 42, 0.5)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Battery size={18} color={socColor} />
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>Battery Health</span>
                    </div>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: socColor }}>{socPct}% ({(soc ?? 0).toFixed(1)} / 47.4 kWh)</span>
                  </div>
                  <div style={{ width: '100%', height: '12px', background: 'rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${socPct}%`, height: '100%', borderRadius: '6px',
                      background: `linear-gradient(90deg, ${socColor}, ${socColor}aa)`,
                      transition: 'width 0.5s ease, background 0.5s ease',
                      boxShadow: `0 0 8px ${socColor}44`
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    <span>Min (9.5 kWh)</span>
                    <span style={{ color: isBatActive ? modeColor : 'var(--text-muted)', fontWeight: isBatActive ? 600 : 400 }}>
                      {(action.chargeKw ?? 0) > 0.01 ? `⚡ Charging at ${(action.chargeKw ?? 0).toFixed(1)} kW` :
                        (action.dischargeKw ?? 0) > 0.01 ? `🔋 Discharging at ${(action.dischargeKw ?? 0).toFixed(1)} kW` :
                          '○ Standby'}
                    </span>
                    <span>Max (42.6 kWh)</span>
                  </div>
                </div>

                {/* Power Flow Summary + Carbon */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem', marginTop: '1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <div style={{ padding: '0.6rem', background: 'rgba(250,204,21,0.08)', borderRadius: '8px', border: '1px solid rgba(250,204,21,0.15)' }}>
                    <Sun size={14} color="#facc15" style={{ display: 'inline', marginRight: '4px' }} />
                    PV → Load: <strong style={{ color: '#facc15' }}>{Math.min(parseFloat(nowPv), parseFloat(nowLoad)).toFixed(1)} kW</strong>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'rgba(59,130,246,0.08)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.15)' }}>
                    <ArrowRightLeft size={14} color="var(--accent-blue)" style={{ display: 'inline', marginRight: '4px' }} />
                    Grid → Load: <strong style={{ color: 'var(--accent-blue)' }}>{(action.importKw ?? 0).toFixed(1)} kW</strong>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'rgba(34,197,94,0.08)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.15)' }}>
                    <Zap size={14} color="var(--accent-green)" style={{ display: 'inline', marginRight: '4px' }} />
                    PV → Grid: <strong style={{ color: 'var(--accent-green)' }}>{(action.exportKw ?? 0).toFixed(1)} kW</strong>
                  </div>
                  <div style={{ padding: '0.6rem', background: 'rgba(34,197,94,0.08)', borderRadius: '8px', border: '1px solid rgba(34,197,94,0.15)' }}>
                    <Leaf size={14} color="var(--accent-green)" style={{ display: 'inline', marginRight: '4px' }} />
                    CO₂ Avoided: <strong style={{ color: 'var(--accent-green)' }}>{(parseFloat(nowPv) * (parseFloat(liveData.carbonIntensity) || 0) / 1000).toFixed(1)} kg</strong>
                  </div>
                </div>

                {/* Carbon Intensity + Data Source Badges */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
                  {/* Carbon Intensity Card */}
                  <div style={{ padding: '1rem', background: 'rgba(15,23,42,0.5)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <Leaf size={18} color={liveData.carbonIntensity < 400 ? 'var(--accent-green)' : liveData.carbonIntensity < 600 ? 'var(--accent-orange)' : 'var(--accent-red)'} />
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>Grid Carbon Intensity</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '2rem', fontWeight: 700, color: liveData.carbonIntensity < 400 ? 'var(--accent-green)' : liveData.carbonIntensity < 600 ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
                        {Math.round(liveData.carbonIntensity)}
                      </span>
                      <span className="kpi-unit">gCO₂/kWh</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {liveData.carbonIntensity < 400 ? '🟢 Clean Grid (renewables high)' : liveData.carbonIntensity < 600 ? '🟡 Moderate (gas + renewables)' : '🔴 High Carbon (coal dominant)'}
                      <span style={{ marginLeft: '0.5rem' }}>• Zone: {liveData.carbonZone}</span>
                    </div>
                  </div>

                  {/* Data Source Badges */}
                  <div style={{ padding: '1rem', background: 'rgba(15,23,42,0.5)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginBottom: '0.75rem' }}>Data Sources</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>☀️ PV Forecast</span>
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', fontWeight: 600,
                          background: (liveData.pvSource || '').includes('live') ? 'rgba(34,197,94,0.2)' : 'rgba(250,204,21,0.2)',
                          color: (liveData.pvSource || '').includes('live') ? 'var(--accent-green)' : '#facc15',
                          border: `1px solid ${(liveData.pvSource || '').includes('live') ? 'rgba(34,197,94,0.3)' : 'rgba(250,204,21,0.3)'}`
                        }}>
                          {(liveData.pvSource || '').includes('live') ? '🟢 Solcast Live' : liveData.pvSource === 'loading' ? '⏳ Loading...' : '🟡 Simulated'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🌍 Carbon Intensity</span>
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', fontWeight: 600,
                          background: (liveData.carbonSource || '').includes('live') ? 'rgba(34,197,94,0.2)' : 'rgba(250,204,21,0.2)',
                          color: (liveData.carbonSource || '').includes('live') ? 'var(--accent-green)' : '#facc15',
                          border: `1px solid ${(liveData.carbonSource || '').includes('live') ? 'rgba(34,197,94,0.3)' : 'rgba(250,204,21,0.3)'}`
                        }}>
                          {(liveData.carbonSource || '').includes('live') ? '🟢 ElectricityMaps Live' : liveData.carbonSource === 'loading' ? '⏳ Loading...' : '🟡 Indian Grid Avg'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🏢 Load Profile</span>
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', fontWeight: 600,
                          background: 'rgba(250,204,21,0.2)', color: '#facc15', border: '1px solid rgba(250,204,21,0.3)'
                        }}>🟡 NREL Commercial</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

        </>
      )}
    </div>
  );
}

export default App;


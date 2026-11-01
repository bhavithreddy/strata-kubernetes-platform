import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Box,
  CheckCircle2,
  CircleHelp,
  Cloud,
  Cpu,
  Database,
  Layers3,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Workflow,
  XCircle,
} from 'lucide-react'
import './App.css'

type Deployment = {
  name: string
  desired_replicas: number
  ready_replicas: number
  available_replicas: number
  images: string[]
}

type Pod = {
  name: string
  phase: string
  node: string
  pod_ip: string
  ready: boolean
  restarts: number
  labels: Record<string, string>
}

type Metric = {
  name: string
  containers: { name: string; cpu?: string; memory?: string }[]
}

type HPA = {
  name: string
  deployment: string
  min_replicas: number
  max_replicas: number
  current_replicas: number
  desired_replicas: number
  current_metrics: {
    type: string
    resource?: { name: string; current?: { average_utilization?: number } }
  }[]
}

type APIList<T> = { items: T[]; namespace: string }
type Cluster = { connected: boolean; namespace: string; config_mode: string }

async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

function formatCPU(value?: string) {
  if (!value) return '—'
  if (value.endsWith('n')) return `${(Number.parseInt(value) / 1e6).toFixed(1)}m`
  if (value.endsWith('u')) return `${(Number.parseInt(value) / 1000).toFixed(1)}m`
  if (value.endsWith('m')) return value
  return `${(Number.parseFloat(value) * 1000).toFixed(1)}m`
}

function formatMemory(value?: string) {
  if (!value) return '—'
  if (value.endsWith('Ki')) return `${(Number.parseInt(value) / 1024).toFixed(1)} MiB`
  if (value.endsWith('Mi')) return `${value.slice(0, -2)} MiB`
  if (value.endsWith('Gi')) return `${(Number.parseFloat(value) * 1024).toFixed(1)} MiB`
  return value
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`status ${ok ? 'status-ok' : 'status-bad'}`}>
      <span className="status-dot" />
      {children}
    </span>
  )
}

function App() {
  const [cluster, setCluster] = useState<Cluster | null>(null)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [pods, setPods] = useState<Pod[]>([])
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [hpas, setHpas] = useState<HPA[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [activeView, setActiveView] = useState('Overview')
  const [imageTag, setImageTag] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [deployMessage, setDeployMessage] = useState('')
  const [deployError, setDeployError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [c, d, p, m, h] = await Promise.all([
        getJSON<Cluster>('/api/cluster'),
        getJSON<APIList<Deployment>>('/api/deployments'),
        getJSON<APIList<Pod>>('/api/pods'),
        getJSON<APIList<Metric>>('/api/metrics'),
        getJSON<APIList<HPA>>('/api/hpa'),
      ])
      setCluster(c)
      setDeployments(d.items)
      setPods(p.items)
      setMetrics(m.items)
      setHpas(h.items)
      setError('')
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect to the Kubernetes API')
    } finally {
      setLoading(false)
    }
  }, [])

  async function submitDeployment() {
    const image = imageTag.trim()

    if (
      !/^platform-demo:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(image)
      || image.endsWith(':latest')
    ) {
      setDeployError('Use a versioned image such as platform-demo:1.0.1. The latest tag is not allowed.')
      setDeployMessage('')
      return
    }

    setDeploying(true)
    setDeployError('')
    setDeployMessage('Submitting deployment request…')

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      })

      const result = await response.json() as {
        detail?: string
        image?: string
        message?: string
      }

      if (!response.ok) {
        throw new Error(result.detail ?? `Deployment request failed: HTTP ${response.status}`)
      }

      const requestedImage = result.image ?? image
      // Deployment progressDeadlineSeconds is 600 seconds.
      // Allow a small buffer for polling and status propagation.
      const rolloutTimeoutMs = 660_000
      const deadline = Date.now() + rolloutTimeoutMs

      setDeployMessage(`Request accepted for ${requestedImage}. Waiting for Kubernetes rollout…`)

      while (Date.now() < deadline) {
        const statusResponse = await fetch(
          '/api/deployments/platform-demo/rollout',
          { cache: 'no-store' },
        )

        if (!statusResponse.ok) {
          throw new Error(`Unable to read rollout status: HTTP ${statusResponse.status}`)
        }

        const rollout = await statusResponse.json() as {
          status: string
          image: string[]
          desired_replicas: number
          updated_replicas: number
          ready_replicas: number
          available_replicas: number
        }

        const imageMatches = rollout.image.includes(requestedImage)
        const allReady =
          rollout.desired_replicas > 0
          && rollout.updated_replicas === rollout.desired_replicas
          && rollout.ready_replicas === rollout.desired_replicas
          && rollout.available_replicas === rollout.desired_replicas

        if (rollout.status === 'Failed') {
          throw new Error(`Kubernetes reports a failed rollout for ${requestedImage}. Inspect the Deployment and pod events.`)
        }

        if (imageMatches && rollout.status === 'Healthy' && allReady) {
          setDeployMessage(
            `Healthy: ${requestedImage} is deployed. ${rollout.ready_replicas}/${rollout.desired_replicas} replicas are ready.`,
          )
          await refresh()
          return
        }

        setDeployMessage(
          `Deploying ${requestedImage} — ${rollout.ready_replicas}/${rollout.desired_replicas} replicas ready.`,
        )

        await new Promise(resolve => window.setTimeout(resolve, 3000))
      }

      throw new Error(
        `Rollout did not become healthy within 660 seconds. Check the status of ${requestedImage} before retrying.`,
      )
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Unable to verify deployment rollout')
      setDeployMessage('')
      await refresh()
    } finally {
      setDeploying(false)
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const totalDesired = deployments.reduce((sum, d) => sum + d.desired_replicas, 0)
  const totalReady = deployments.reduce((sum, d) => sum + d.ready_replicas, 0)
  const readyPods = pods.filter(p => p.ready).length
  const failedPods = pods.filter(p => p.phase === 'Failed' || p.phase === 'Unknown').length
  const metricByPod = new Map(metrics.map(m => [m.name, m]))
  const cpuPercent = (h: HPA) => h.current_metrics.find(m => m.resource?.name === 'cpu')?.resource?.current?.average_utilization

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Layers3 size={22} /></div>
          <div><strong>Strata</strong><span>PLATFORM ENGINEERING</span></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <button className={`nav-item ${activeView === 'Overview' ? 'active' : ''}`} onClick={() => setActiveView('Overview')}><Activity size={17} /> Overview</button>
        <button className={`nav-item ${activeView === 'Workloads' ? 'active' : ''}`} onClick={() => setActiveView('Workloads')}><Box size={17} /> Workloads <span className="nav-count">{deployments.length}</span></button>
        <button className={`nav-item ${activeView === 'Autoscaling' ? 'active' : ''}`} onClick={() => setActiveView('Autoscaling')}><Workflow size={17} /> Autoscaling</button>
        <button className={`nav-item ${activeView === 'Infrastructure' ? 'active' : ''}`} onClick={() => setActiveView('Infrastructure')}><Network size={17} /> Infrastructure</button>
        <div className="sidebar-bottom">
          <div className="cluster-mini"><span className="cluster-pulse" /><div><strong>kind · local</strong><span>{cluster?.namespace ?? 'platform-demo'}</span></div></div>
          <div className="sidebar-footer"><ShieldCheck size={15} /> Read-only access</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Platform</span><span className="crumb-sep">/</span><strong>{activeView}</strong></div>
          <div className="topbar-actions">
            <span className="environment"><span /> LOCAL CLUSTER</span>
            <button className="refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
          </div>
        </header>

        <section className="page-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> KUBERNETES OPERATIONS</div>
            <h1>{activeView === 'Overview' ? 'Cluster overview' : activeView}</h1>
            <p>Monitor workloads, resource consumption, and autoscaling activity.</p>
          </div>
          <div className="update-meta"><span className="live-dot" /> Live telemetry <span className="meta-divider">·</span> {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Waiting for data'}</div>
        </section>

        {error && <div className="error-banner"><XCircle size={18} /><div><strong>Unable to load cluster data</strong><span>{error}. Check the API port-forward on localhost:8002.</span></div><button onClick={() => void refresh()}>Retry</button></div>}

        <section className="stat-grid">
          <article className="stat-card">
            <div className="stat-top"><span>CLUSTER CONNECTION</span><div className="stat-icon violet"><Cloud size={18} /></div></div>
            <div className="stat-value stat-connection">{cluster?.connected ? 'Connected' : loading ? 'Connecting…' : 'Offline'}</div>
            <div className="stat-foot"><Status ok={!!cluster?.connected}>{cluster?.connected ? 'API reachable' : 'Connection pending'}</Status></div>
          </article>
          <article className="stat-card">
            <div className="stat-top"><span>DEPLOYMENTS</span><div className="stat-icon blue"><Layers3 size={18} /></div></div>
            <div className="stat-value">{deployments.length}</div>
            <div className="stat-foot"><span>{totalReady} of {totalDesired} replicas ready</span><span className="foot-icon"><ArrowUpRight size={14} /></span></div>
          </article>
          <article className="stat-card">
            <div className="stat-top"><span>HEALTHY PODS</span><div className="stat-icon green"><CheckCircle2 size={18} /></div></div>
            <div className="stat-value">{readyPods}<span className="stat-denom"> / {pods.length}</span></div>
            <div className="stat-foot"><Status ok={failedPods === 0}>{failedPods === 0 ? 'No failed pods' : `${failedPods} failed pods`}</Status></div>
          </article>
          <article className="stat-card">
            <div className="stat-top"><span>AUTOSCALERS</span><div className="stat-icon amber"><Activity size={18} /></div></div>
            <div className="stat-value">{hpas.length}</div>
            <div className="stat-foot"><span>{hpas.reduce((sum, h) => sum + h.current_replicas, 0)} current replicas managed</span></div>
          </article>
        </section>

        {activeView === 'Overview' && (
          <section className="overview-grid">
            <article className="panel workload-panel">
              <div className="panel-heading"><div><h2>Workload health</h2><p>Deployment availability across the namespace</p></div><span className="panel-tag">{deployments.length} DEPLOYMENTS</span></div>
              <div className="workload-list">
                {deployments.map(d => {
                  const healthy = d.ready_replicas === d.desired_replicas && d.desired_replicas > 0
                  return <div className="workload-row" key={d.name}>
                    <div className="workload-symbol"><Box size={17} /></div>
                    <div className="workload-main"><strong>{d.name}</strong><span>{d.images[0] ?? 'Image unavailable'}</span><div className="replica-track"><span style={{ width: `${d.desired_replicas ? Math.min(100, d.ready_replicas / d.desired_replicas * 100) : 0}%` }} /></div></div>
                    <div className="workload-replicas"><strong>{d.ready_replicas}<span>/{d.desired_replicas}</span></strong><Status ok={healthy}>{healthy ? 'Healthy' : 'Degraded'}</Status></div>
                  </div>
                })}
                {!deployments.length && <div className="empty-state">{loading ? 'Loading deployments…' : 'No deployments found.'}</div>}
              </div>
            </article>

            <article className="panel autoscale-panel">
              <div className="panel-heading"><div><h2>Autoscaling</h2><p>Horizontal Pod Autoscaler status</p></div><div className="panel-icon"><Activity size={18} /></div></div>
              {hpas.map(h => {
                const cpu = cpuPercent(h)
                const fill = Math.min(100, cpu ?? 0)
                return <div className="hpa-block" key={h.name}>
                  <div className="hpa-title"><strong>{h.name}</strong><span className="hpa-active"><span /> ACTIVE</span></div>
                  <div className="cpu-caption"><span>CPU utilization</span><strong>{cpu === undefined ? '—' : `${cpu}%`} <small>/ 50% target</small></strong></div>
                  <div className="cpu-track"><span style={{ width: `${fill}%` }} /></div>
                  <div className="hpa-scale"><span>Min <strong>{h.min_replicas}</strong></span><span>Current <strong>{h.current_replicas}</strong></span><span>Max <strong>{h.max_replicas}</strong></span></div>
                  <div className="replica-visual">{Array.from({ length: h.max_replicas }, (_, i) => <span key={i} className={i < h.current_replicas ? 'replica-on' : ''} />)}</div>
                </div>
              })}
              {!hpas.length && <div className="empty-state">{loading ? 'Loading autoscalers…' : 'No HPAs found.'}</div>}
              <div className="panel-note"><CircleHelp size={14} /> CPU utilization is reported against pod CPU requests.</div>
            </article>

            <article className="panel pods-panel">
              <div className="panel-heading"><div><h2>Pod inventory</h2><p>Current pod placement and health</p></div><span className="panel-tag">{pods.length} PODS</span></div>
              <div className="table-wrap"><table><thead><tr><th>POD</th><th>STATUS</th><th>NODE</th><th>CPU</th><th>MEMORY</th><th>RESTARTS</th></tr></thead>
                <tbody>{pods.map(p => {
                  const metric = metricByPod.get(p.name)
                  const cpu = metric?.containers.reduce((s, c) => s + (Number.parseFloat(formatCPU(c.cpu)) || 0), 0)
                  return <tr key={p.name}><td><div className="pod-name"><span className={`pod-indicator ${p.ready ? 'is-ready' : ''}`} /><strong>{p.name}</strong></div></td><td><Status ok={p.ready && p.phase === 'Running'}>{p.phase}</Status></td><td className="muted-cell">{p.node || '—'}</td><td className="mono-cell">{cpu === undefined ? '—' : `${cpu.toFixed(1)}m`}</td><td className="mono-cell">{metric?.containers.length ? metric.containers.map(c => formatMemory(c.memory)).join(', ') : '—'}</td><td><span className={p.restarts ? 'restart-warning' : 'muted-cell'}>{p.restarts} {p.restarts ? <ArrowDownRight size={12} /> : ''}</span></td></tr>
                })}</tbody>
              </table>
              {!pods.length && <div className="empty-state">{loading ? 'Loading pods…' : 'No pods found.'}</div>}</div>
            </article>

            <article className="panel quick-panel">
              <div className="panel-heading"><div><h2>Platform components</h2><p>Core services in this environment</p></div></div>
              <div className="component-row"><div className="component-icon"><Server size={17} /></div><div><strong>Kind cluster</strong><span>3-node local environment</span></div><Status ok={!!cluster?.connected}>{cluster?.connected ? 'Online' : 'Unknown'}</Status></div>
              <div className="component-row"><div className="component-icon"><Network size={17} /></div><div><strong>Traefik ingress</strong><span>HTTP routing and TLS termination</span></div><Status ok={!!cluster?.connected}>{cluster?.connected ? 'Configured' : 'Unknown'}</Status></div>
              <div className="component-row"><div className="component-icon"><Cpu size={17} /></div><div><strong>Metrics Server</strong><span>Resource metrics API</span></div><Status ok={metrics.length > 0}>{metrics.length ? 'Reporting' : 'Pending'}</Status></div>
              <div className="component-row"><div className="component-icon"><Database size={17} /></div><div><strong>Platform API</strong><span>FastAPI · Kubernetes client</span></div><Status ok={!!cluster?.connected}>{cluster?.connected ? 'Reachable' : 'Unknown'}</Status></div>
              <div className="component-row"><div className="component-icon"><Terminal size={17} /></div><div><strong>Access model</strong><span>Namespace-scoped reader role</span><Status ok>Read only</Status></div></div>
            </article>
          </section>
        )}

        {activeView === 'Workloads' && <>
          <section className="panel detail-panel deploy-panel">
            <div className="panel-heading">
              <div>
                <h2>Deploy application</h2>
                <p>Update the image for the approved platform-demo Deployment</p>
              </div>
              <span className="panel-tag">SELF-SERVICE</span>
            </div>
            <form className="deploy-form" onSubmit={event => {
              event.preventDefault()
              void submitDeployment()
            }}>
              <label htmlFor="deployment-image">Container image</label>
              <div className="deploy-form-row">
                <input
                  id="deployment-image"
                  name="image"
                  value={imageTag}
                  onChange={event => setImageTag(event.target.value)}
                  placeholder="platform-demo:1.0.1"
                  pattern="platform-demo:[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
                  title="Enter platform-demo followed by a version tag. Do not use latest."
                  maxLength={128}
                  required
                  disabled={deploying}
                />
                <button className="deploy-button" type="submit" disabled={deploying}>
                  {deploying ? 'Submitting…' : 'Deploy image'}
                </button>
              </div>
              <p className="deploy-help">
                Only versioned platform-demo images are accepted. Deployment readiness must be verified after submission.
              </p>
              {deployError && <div className="deploy-feedback deploy-feedback-error" role="alert">{deployError}</div>}
              {deployMessage && <div className="deploy-feedback deploy-feedback-success" role="status">{deployMessage}</div>}
            </form>
          </section>

          <section className="panel detail-panel">
            <div className="panel-heading">
              <div><h2>Deployments</h2><p>Images, desired replicas, and availability</p></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>IMAGE</th><th>DESIRED</th><th>READY</th><th>AVAILABLE</th><th>HEALTH</th></tr></thead>
                <tbody>{deployments.map(d => <tr key={d.name}>
                  <td><strong>{d.name}</strong></td>
                  <td className="mono-cell">{d.images.join(', ')}</td>
                  <td>{d.desired_replicas}</td>
                  <td>{d.ready_replicas}</td>
                  <td>{d.available_replicas}</td>
                  <td><Status ok={d.ready_replicas === d.desired_replicas}>{d.ready_replicas === d.desired_replicas ? 'Healthy' : 'Degraded'}</Status></td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
        </>}
        {activeView === 'Autoscaling' && <section className="panel detail-panel"><div className="panel-heading"><div><h2>Horizontal Pod Autoscalers</h2><p>Current metrics and scaling bounds</p></div></div><div className="table-wrap"><table><thead><tr><th>HPA</th><th>TARGET</th><th>CPU</th><th>MIN</th><th>CURRENT</th><th>DESIRED</th><th>MAX</th></tr></thead><tbody>{hpas.map(h => <tr key={h.name}><td><strong>{h.name}</strong></td><td>{h.deployment}</td><td>{cpuPercent(h) === undefined ? '—' : `${cpuPercent(h)}%`}</td><td>{h.min_replicas}</td><td>{h.current_replicas}</td><td>{h.desired_replicas}</td><td>{h.max_replicas}</td></tr>)}</tbody></table></div></section>}
        {activeView === 'Infrastructure' && <section className="panel detail-panel"><div className="panel-heading"><div><h2>Infrastructure inventory</h2><p>Pods currently scheduled in your local cluster</p></div></div><div className="table-wrap"><table><thead><tr><th>POD</th><th>NODE</th><th>IP ADDRESS</th><th>PHASE</th><th>RESTARTS</th></tr></thead><tbody>{pods.map(p => <tr key={p.name}><td><strong>{p.name}</strong></td><td>{p.node}</td><td className="mono-cell">{p.pod_ip}</td><td><Status ok={p.ready}>{p.phase}</Status></td><td>{p.restarts}</td></tr>)}</tbody></table></div></section>}

        <footer className="footer"><div><span className="footer-mark"><Layers3 size={14} /></span> STRATA <span className="footer-separator">/</span> Kubernetes Self-Service Platform</div><span>Read-only dashboard <span className="footer-separator">·</span> Auto-refresh every 15s</span></footer>
      </main>
    </div>
  )
}

export default App

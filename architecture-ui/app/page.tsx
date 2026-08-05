"use client";

import { useMemo, useRef, useState } from "react";

type Mode = "overview" | "order" | "catalog" | "delivery" | "secrets" | "airflow" | "observe";
type Environment = "kind" | "gke";

type NodeData = {
  id: string;
  label: string;
  subtitle: string;
  icon: string;
  tone: string;
  x: number;
  y: number;
  w?: number;
  namespace?: string;
  type?: string;
  protocol?: string;
  detail?: string;
  source?: string;
  status?: string;
};

type EdgeData = {
  id: string;
  from: string;
  to: string;
  label?: string;
  color: string;
  dashed?: boolean;
  particles?: number;
  reverse?: boolean;
};

const MODES: { id: Mode; label: string; kicker: string }[] = [
  { id: "overview", label: "Overview", kicker: "The entire platform" },
  { id: "order", label: "Order flow", kicker: "Synchronous + asynchronous" },
  { id: "catalog", label: "Catalog & cache", kicker: "Cache-aside" },
  { id: "delivery", label: "CI/CD + GitOps", kicker: "Code to cluster" },
  { id: "secrets", label: "Secrets", kicker: "Vault to workload" },
  { id: "airflow", label: "Data pipeline", kicker: "ETL at 02:00 UTC" },
  { id: "observe", label: "Observability", kicker: "Cluster signals" },
];

const baseNodes: Record<string, Omit<NodeData, "x" | "y">> = {
  browser: { id: "browser", label: "User", subtitle: "Browser", icon: "◎", tone: "cyan", type: "HTTP client", protocol: "HTTP", detail: "Starts catalog queries and the order creation flow." },
  frontend: { id: "frontend", label: "Frontend", subtitle: "Storefront + proxy", icon: "FE", tone: "cyan", namespace: "apps", type: "Deployment · Express", protocol: "HTTP :3000", detail: "Static page and thin proxy to the BFF. Uses no credentials.", source: "apps/frontend · gitops/services/frontend" },
  bff: { id: "bff", label: "BFF", subtitle: "Backend for frontend", icon: "BF", tone: "cyan", namespace: "apps", type: "Deployment · Express", protocol: "HTTP :3000", detail: "Proxy and aggregation layer between the interface and API. Uses no credentials.", source: "apps/bff · gitops/services/bff" },
  backend: { id: "backend", label: "Backend", subtitle: "Orders + catalog API", icon: "API", tone: "blue", namespace: "apps", type: "Deployment · Express", protocol: "HTTP :3000", detail: "Source of truth for writes. Persists each order before asynchronous publication.", source: "apps/backend · gitops/services/backend" },
  worker: { id: "worker", label: "Worker", subtitle: "E-mail + invoice stub", icon: "WK", tone: "orange", namespace: "apps", type: "Deployment · Node", protocol: "AMQP", detail: "Consumes orders.created, runs the handler, and manually acknowledges the message.", source: "apps/worker · gitops/services/worker" },
  postgres: { id: "postgres", label: "PostgreSQL", subtitle: "Orders + reports", icon: "PG", tone: "blue", namespace: "postgres", type: "CloudNativePG · 1 instance", protocol: "SQL :5432", detail: "Stores products, orders, Airflow metadata, and reporting tables. No HA in this lab.", source: "gitops/data/postgres" },
  redis: { id: "redis", label: "Redis", subtitle: "Catalog cache · TTL 60s", icon: "R", tone: "red", namespace: "redis", type: "Deployment · ephemeral", protocol: "RESP :6379", detail: "Catalog cache-aside layer. No PVC; losing cache data after a restart is accepted.", source: "gitops/data/redis" },
  rabbit: { id: "rabbit", label: "RabbitMQ", subtitle: "orders.created", icon: "RM", tone: "orange", namespace: "rabbitmq", type: "Deployment · ephemeral", protocol: "AMQP :5672", detail: "Durable task queue without a PVC in the lab. Delivers orders to the Worker.", source: "gitops/data/rabbitmq" },
  kafka: { id: "kafka", label: "Kafka", subtitle: "order-events", icon: "K", tone: "violet", namespace: "kafka", type: "Strimzi · KRaft · 1 node", protocol: "SASL/SCRAM", detail: "Immutable, replayable log. The Backend writes; Airflow consumes with its own identity.", source: "gitops/data/kafka" },
  airflow: { id: "airflow", label: "Airflow", subtitle: "sales_report DAG", icon: "AF", tone: "sky", namespace: "airflow", type: "LocalExecutor", protocol: "SQL + Kafka", detail: "Runs two independent tasks: aggregates sales and consumes events. Schedule: 02:00 UTC.", source: "gitops/apps/airflow.yaml · gitops/data/airflow" },
  argocd: { id: "argocd", label: "Argo CD", subtitle: "App of apps", icon: "AR", tone: "orange", namespace: "argocd", type: "Helm + root Application", protocol: "GitOps", detail: "Recursively reconciles apps, data, and services from gitops/.", source: "terraform/delivery · gitops/root-app.yaml" },
  vault: { id: "vault", label: "Vault", subtitle: "KV + Kubernetes auth", icon: "V", tone: "yellow", namespace: "vault", type: "Dev mode", protocol: "HTTPS API", detail: "Credential source. State is lost after a restart and requires a new bootstrap.", source: "gitops/apps/vault.yaml · scripts/bootstrap-vault.sh" },
  eso: { id: "eso", label: "External Secrets", subtitle: "Secret synchronization", icon: "ES", tone: "green", namespace: "external-secrets", type: "Operator", protocol: "Kubernetes API", detail: "Turns authorized Vault values into Secrets consumed by workloads.", source: "gitops/apps/external-secrets.yaml" },
  prometheus: { id: "prometheus", label: "Prometheus", subtitle: "Cluster metrics", icon: "P", tone: "orange", namespace: "monitoring", type: "kube-prometheus-stack", protocol: "PromQL", detail: "Collects cluster metrics. The application tier does not expose /metrics or a ServiceMonitor yet.", source: "gitops/apps/kube-prometheus-stack.yaml" },
  grafana: { id: "grafana", label: "Grafana", subtitle: "28 dashboards", icon: "G", tone: "orange", namespace: "monitoring", type: "kube-prometheus-stack", protocol: "PromQL", detail: "Queries Prometheus and presents the chart's default dashboards. Ephemeral storage.", source: "gitops/apps/kube-prometheus-stack.yaml" },
};

const n = (id: string, x: number, y: number, extra: Partial<NodeData> = {}): NodeData => ({ ...baseNodes[id], x, y, ...extra } as NodeData);

const graphs: Record<Mode, { title: string; description: string; nodes: NodeData[]; edges: EdgeData[]; note?: string }> = {
  overview: {
    title: "Cloud Native Lab",
    description: "An order platform where infrastructure is treated as a product.",
    nodes: [n("browser", 55, 320), n("frontend", 250, 320), n("bff", 455, 320), n("backend", 665, 320), n("postgres", 930, 160), n("redis", 930, 300), n("rabbit", 930, 440), n("kafka", 930, 580), n("worker", 1190, 440), n("airflow", 1190, 650), n("argocd", 420, 70), n("vault", 665, 70), n("eso", 930, 70), n("prometheus", 440, 650), n("grafana", 665, 650)],
    edges: [
      { id: "ov1", from: "browser", to: "frontend", label: "HTTP", color: "#22d3ee", particles: 1 },
      { id: "ov2", from: "frontend", to: "bff", color: "#22d3ee", particles: 1 },
      { id: "ov3", from: "bff", to: "backend", color: "#38bdf8", particles: 1 },
      { id: "ov4", from: "backend", to: "postgres", label: "SQL", color: "#60a5fa", particles: 1 },
      { id: "ov5", from: "backend", to: "redis", label: "cache", color: "#fb7185", particles: 1 },
      { id: "ov6", from: "backend", to: "rabbit", label: "AMQP", color: "#fb923c", particles: 2 },
      { id: "ov7", from: "backend", to: "kafka", label: "events", color: "#a78bfa", particles: 2 },
      { id: "ov8", from: "rabbit", to: "worker", color: "#fb923c", particles: 1 },
      { id: "ov9", from: "kafka", to: "airflow", color: "#a78bfa", particles: 1 },
      { id: "ov10", from: "airflow", to: "postgres", color: "#38bdf8", particles: 1 },
      { id: "ov11", from: "vault", to: "eso", label: "secrets", color: "#34d399", dashed: true, particles: 1 },
      { id: "ov12", from: "argocd", to: "backend", label: "reconcile", color: "#fbbf24", dashed: true, particles: 1 },
      { id: "ov13", from: "prometheus", to: "grafana", label: "query", color: "#a3e635", particles: 1 },
    ],
    note: "Select any component to inspect how it is actually implemented in the repository.",
  },
  order: {
    title: "One order, three paths",
    description: "The commit happens first; RabbitMQ and Kafka are best-effort and never block the response.",
    nodes: [n("browser", 40, 300), n("frontend", 225, 300), n("bff", 420, 300), n("backend", 620, 300), n("postgres", 865, 105), n("rabbit", 865, 300), n("kafka", 865, 520), n("worker", 1130, 300), n("airflow", 1130, 520)],
    edges: [
      { id: "or1", from: "browser", to: "frontend", label: "POST /api/orders", color: "#22d3ee", particles: 2 },
      { id: "or2", from: "frontend", to: "bff", label: "POST /orders", color: "#22d3ee", particles: 1 },
      { id: "or3", from: "bff", to: "backend", color: "#38bdf8", particles: 1 },
      { id: "or4", from: "backend", to: "postgres", label: "BEGIN · INSERT · COMMIT", color: "#60a5fa", particles: 2 },
      { id: "or5", from: "backend", to: "rabbit", label: "orders.created", color: "#fb923c", particles: 2 },
      { id: "or6", from: "backend", to: "kafka", label: "order.created", color: "#a78bfa", particles: 2 },
      { id: "or7", from: "rabbit", to: "worker", label: "consume + ack", color: "#fb923c", particles: 1 },
      { id: "or8", from: "kafka", to: "airflow", label: "nightly replay", color: "#a78bfa", particles: 1 },
      { id: "or9", from: "backend", to: "browser", label: "201 Created", color: "#34d399", dashed: true, reverse: true, particles: 1 },
    ],
    note: "A publication failure is logged, but never rolls back an already persisted order.",
  },
  catalog: {
    title: "Catalog cache-aside",
    description: "Redis responds immediately on a hit; on a miss, the API queries PostgreSQL and fills the cache for 60 seconds.",
    nodes: [n("browser", 80, 300), n("frontend", 285, 300), n("bff", 505, 300), n("backend", 725, 300), n("redis", 1000, 155), n("postgres", 1000, 455)],
    edges: [
      { id: "ca1", from: "browser", to: "frontend", label: "GET /catalog", color: "#22d3ee", particles: 2 },
      { id: "ca2", from: "frontend", to: "bff", color: "#22d3ee", particles: 1 },
      { id: "ca3", from: "bff", to: "backend", color: "#38bdf8", particles: 1 },
      { id: "ca4", from: "backend", to: "redis", label: "GET catalog:items", color: "#fb7185", particles: 2 },
      { id: "ca5", from: "redis", to: "backend", label: "HIT · cached JSON", color: "#34d399", dashed: true, reverse: true, particles: 1 },
      { id: "ca6", from: "backend", to: "postgres", label: "MISS · SELECT products", color: "#60a5fa", particles: 1 },
      { id: "ca7", from: "postgres", to: "redis", label: "SET · EX 60", color: "#fbbf24", particles: 1 },
    ],
    note: "Redis is intentionally ephemeral: losing the cache does not compromise the source of truth.",
  },
  delivery: {
    title: "From commit to cluster",
    description: "Automation prepares the change; human approval remains the delivery gate.",
    nodes: [
      { id: "developer", label: "Developer", subtitle: "git push", icon: "DEV", tone: "cyan", x: 45, y: 300, type: "Human", detail: "Pushes changes to one of the four services." },
      { id: "github", label: "GitHub", subtitle: "Source repository", icon: "GH", tone: "slate", x: 240, y: 300, type: "Git", detail: "Triggers the service-specific reusable workflow." },
      { id: "actions", label: "GitHub Actions", subtitle: "Build · test · scan", icon: "CI", tone: "blue", x: 445, y: 155, type: "CI", detail: "Builds once, tests, and reuses the same artifact for scanning and pushing." },
      { id: "trivy", label: "Trivy", subtitle: "HIGH + CRITICAL gate", icon: "TV", tone: "green", x: 445, y: 455, type: "Security gate", detail: "Fails the pipeline on fixable HIGH or CRITICAL vulnerabilities." },
      { id: "ghcr", label: "GHCR", subtitle: "Image :git-sha", icon: "CR", tone: "violet", x: 680, y: 155, type: "Container registry", detail: "Receives the immutable image after build, test, and scan succeed." },
      { id: "pr", label: "GitOps PR", subtitle: "Bump image tag", icon: "PR", tone: "yellow", x: 680, y: 455, type: "Pull request", detail: "Updates only the tag in gitops/services/<service>/deployment.yaml." },
      { id: "human", label: "Human gate", subtitle: "Review + merge", icon: "✓", tone: "yellow", x: 920, y: 455, type: "Approval", detail: "Automation never merges. Human review remains mandatory." },
      n("argocd", 920, 155),
      { id: "cluster", label: "Kubernetes", subtitle: "Reconciled workload", icon: "K8s", tone: "cyan", x: 1170, y: 300, type: "Runtime", detail: "Argo CD applies the approved manifest and the workload starts using the new image." },
    ],
    edges: [
      { id: "de1", from: "developer", to: "github", color: "#22d3ee", particles: 1 },
      { id: "de2", from: "github", to: "actions", label: "trigger", color: "#60a5fa", particles: 1 },
      { id: "de3", from: "actions", to: "trivy", label: "image.tar", color: "#34d399", particles: 1 },
      { id: "de4", from: "actions", to: "ghcr", label: "push", color: "#a78bfa", particles: 2 },
      { id: "de5", from: "ghcr", to: "pr", label: "bump SHA", color: "#fbbf24", particles: 1 },
      { id: "de6", from: "pr", to: "human", label: "review", color: "#fbbf24", particles: 1 },
      { id: "de7", from: "human", to: "argocd", label: "merge main", color: "#34d399", particles: 1 },
      { id: "de8", from: "argocd", to: "cluster", label: "reconcile", color: "#fb923c", particles: 2 },
    ],
    note: "Build → test → scan → push → GitOps PR → human review → Argo CD.",
  },
  secrets: {
    title: "Least-privilege credentials",
    description: "Each workload receives only what it needs; Frontend and BFF remain credential-free.",
    nodes: [n("vault", 80, 300), n("eso", 330, 300), n("backend", 660, 100), n("worker", 930, 100), n("postgres", 660, 330), n("kafka", 930, 330), n("airflow", 795, 560), n("frontend", 1170, 100, { status: "No secrets" }), n("bff", 1170, 330, { status: "No secrets" })],
    edges: [
      { id: "se1", from: "vault", to: "eso", label: "Kubernetes auth + KV", color: "#fbbf24", particles: 2 },
      { id: "se2", from: "eso", to: "backend", label: "DB · Redis · AMQP · Kafka", color: "#34d399", dashed: true, particles: 1 },
      { id: "se3", from: "eso", to: "worker", label: "RabbitMQ only", color: "#34d399", dashed: true, particles: 1 },
      { id: "se4", from: "eso", to: "postgres", color: "#34d399", dashed: true, particles: 1 },
      { id: "se5", from: "eso", to: "kafka", color: "#34d399", dashed: true, particles: 1 },
      { id: "se6", from: "eso", to: "airflow", label: "metadata · SQL · Kafka", color: "#34d399", dashed: true, particles: 1 },
    ],
    note: "Vault runs in dev mode: after a restart, scripts/bootstrap-vault.sh restores auth, policies, and KV.",
  },
  airflow: {
    title: "Nightly ETL, two independent tasks",
    description: "At 02:00 UTC, the same scheduler runs local subprocesses and consolidates the data.",
    nodes: [
      { id: "clock", label: "02:00 UTC", subtitle: "Cron schedule", icon: "◷", tone: "sky", x: 80, y: 300, type: "Schedule", detail: "The DAG can also be triggered manually." },
      n("airflow", 330, 300, { w: 210 }), n("postgres", 700, 130), n("kafka", 700, 470),
      { id: "sales", label: "sales_reports", subtitle: "Daily aggregates", icon: "Σ", tone: "green", x: 1060, y: 130, type: "PostgreSQL table", detail: "Result of aggregating orders and products." },
      { id: "counts", label: "kafka_event_counts", subtitle: "Event totals", icon: "#", tone: "violet", x: 1060, y: 470, type: "PostgreSQL table", detail: "Result of replaying order-events through the airflow-sales-report group." },
    ],
    edges: [
      { id: "af1", from: "clock", to: "airflow", label: "trigger", color: "#38bdf8", particles: 1 },
      { id: "af2", from: "airflow", to: "postgres", label: "read orders + products", color: "#60a5fa", particles: 2 },
      { id: "af3", from: "airflow", to: "kafka", label: "consume order-events", color: "#a78bfa", particles: 2 },
      { id: "af4", from: "postgres", to: "sales", label: "write", color: "#34d399", particles: 1 },
      { id: "af5", from: "kafka", to: "counts", label: "write", color: "#a78bfa", particles: 1 },
    ],
    note: "There is no data warehouse: metadata, transactional source, and reports share the same PostgreSQL cluster.",
  },
  observe: {
    title: "Cluster observability",
    description: "What is available today — and the deliberately visible application instrumentation gap.",
    nodes: [
      { id: "nodeexp", label: "node-exporter", subtitle: "Host metrics", icon: "NE", tone: "green", x: 100, y: 160, type: "DaemonSet", detail: "Exposes metrics from the cluster nodes." },
      { id: "ksm", label: "kube-state-metrics", subtitle: "Object state", icon: "KS", tone: "green", x: 100, y: 440, type: "Deployment", detail: "Exposes Kubernetes API object state." },
      n("prometheus", 450, 300, { w: 210 }), n("grafana", 800, 300, { w: 210 }),
      { id: "viewer", label: "Platform engineer", subtitle: "28 dashboards", icon: "◎", tone: "cyan", x: 1150, y: 300, type: "Viewer", detail: "Queries the default dashboards and investigates cluster state." },
      { id: "apps", label: "Application tier", subtitle: "No /metrics yet", icon: "!", tone: "red", x: 450, y: 600, w: 210, type: "Observability gap", detail: "Backend, BFF, Frontend, and Worker do not expose /metrics or a ServiceMonitor yet." },
    ],
    edges: [
      { id: "ob1", from: "nodeexp", to: "prometheus", label: "scrape", color: "#a3e635", particles: 2 },
      { id: "ob2", from: "ksm", to: "prometheus", label: "scrape", color: "#a3e635", particles: 2 },
      { id: "ob3", from: "prometheus", to: "grafana", label: "PromQL", color: "#fb923c", particles: 2 },
      { id: "ob4", from: "grafana", to: "viewer", label: "visualize", color: "#22d3ee", particles: 1 },
      { id: "ob5", from: "apps", to: "prometheus", label: "not instrumented", color: "#fb7185", dashed: true, particles: 0 },
    ],
    note: "Alertmanager is disabled. Prometheus and Grafana use emptyDir and do not persist after recreation.",
  },
};

const toneColor: Record<string, string> = { cyan: "#22d3ee", blue: "#60a5fa", sky: "#38bdf8", red: "#fb7185", orange: "#fb923c", violet: "#a78bfa", yellow: "#fbbf24", green: "#34d399", slate: "#94a3b8" };

function pathFor(edge: EdgeData, nodes: NodeData[]) {
  const a = nodes.find((node) => node.id === edge.from)!;
  const b = nodes.find((node) => node.id === edge.to)!;
  const aw = a.w ?? 174;
  const bw = b.w ?? 174;
  const ax = a.x + aw / 2;
  const ay = a.y + 43;
  const bx = b.x + bw / 2;
  const by = b.y + 43;
  const dx = bx - ax;
  const dy = by - ay;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sx = horizontal ? ax + Math.sign(dx) * aw / 2 : ax;
  const sy = horizontal ? ay : ay + Math.sign(dy) * 43;
  const ex = horizontal ? bx - Math.sign(dx) * bw / 2 : bx;
  const ey = horizontal ? by : by - Math.sign(dy) * 43;
  if (horizontal) {
    const bend = Math.max(60, Math.abs(ex - sx) * 0.46);
    return `M ${sx} ${sy} C ${sx + Math.sign(dx) * bend} ${sy}, ${ex - Math.sign(dx) * bend} ${ey}, ${ex} ${ey}`;
  }
  const bend = Math.max(60, Math.abs(ey - sy) * 0.46);
  return `M ${sx} ${sy} C ${sx} ${sy + Math.sign(dy) * bend}, ${ex} ${ey - Math.sign(dy) * bend}, ${ex} ${ey}`;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("overview");
  const [environment, setEnvironment] = useState<Environment>("kind");
  const [selected, setSelected] = useState<NodeData | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const graph = graphs[mode];
  const selectedMode = MODES.find((item) => item.id === mode)!;
  const environmentCopy = environment === "kind"
    ? { label: "Kind · current environment", status: "IMPLEMENTED", detail: "Locally validated through Phase 7" }
    : { label: "GKE · cloud architecture", status: "CODE READY", detail: "Terraform available · apply pending" };

  const connections = useMemo(() => graph.edges.map((edge) => ({ ...edge, path: pathFor(edge, graph.nodes) })), [graph]);

  const exportView = async () => {
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#07101c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(100,140,170,.10)";
      ctx.lineWidth = 1;
      for (let x = 0; x < 1440; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 900); ctx.stroke(); }
      for (let y = 0; y < 900; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1440, y); ctx.stroke(); }
      ctx.fillStyle = "#eaf4fb";
      ctx.font = "700 30px Arial";
      ctx.fillText(graph.title, 42, 50);
      ctx.fillStyle = "#7890a4";
      ctx.font = "14px Arial";
      ctx.fillText(graph.description, 42, 77);
      ctx.fillStyle = environment === "kind" ? "#34d399" : "#fbbf24";
      ctx.font = "700 12px Arial";
      ctx.fillText(environmentCopy.label, 1160, 50);
      ctx.save();
      ctx.translate(0, 80);
      connections.forEach((edge) => {
        ctx.strokeStyle = edge.color;
        ctx.globalAlpha = .58;
        ctx.lineWidth = 2;
        if (edge.dashed) ctx.setLineDash([6, 7]); else ctx.setLineDash([]);
        ctx.stroke(new Path2D(edge.path));
      });
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      graph.nodes.forEach((node) => {
        const width = node.w ?? 174;
        ctx.fillStyle = "#0b1825";
        ctx.strokeStyle = `${toneColor[node.tone]}66`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(node.x, node.y, width, 86, 11);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = toneColor[node.tone];
        ctx.font = "800 13px Arial";
        ctx.fillText(node.icon, node.x + 14, node.y + 31);
        ctx.fillStyle = "#edf5fc";
        ctx.font = "700 13px Arial";
        ctx.fillText(node.label, node.x + 48, node.y + 31);
        ctx.fillStyle = "#6f8397";
        ctx.font = "10px Arial";
        ctx.fillText(node.subtitle, node.x + 48, node.y + 52);
      });
      ctx.restore();
      ctx.fillStyle = "#5f7487";
      ctx.font = "11px Arial";
      ctx.fillText(`Cloud Native Lab · ${graph.nodes.length} components · ${graph.edges.length} connections`, 42, 875);
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `cloud-native-lab-${mode}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setExporting(false);
    }
  };

  const toggleFullscreen = async () => {
    if (!frameRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await frameRef.current.requestFullscreen();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <div><strong>Cloud Native Lab</strong><small>Interactive architecture</small></div>
        </div>
        <div className="topbar-actions">
          <div className="environment-switch" aria-label="Select environment">
            <button className={environment === "kind" ? "active" : ""} onClick={() => setEnvironment("kind")}>Kind</button>
            <button className={environment === "gke" ? "active" : ""} onClick={() => setEnvironment("gke")}>GKE</button>
          </div>
          <button className="ghost-button" onClick={exportView} disabled={exporting} aria-label="Export view as PNG">↗ <span>{exporting ? "Generating…" : "Export PNG"}</span></button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">EXPLORE FLOWS</p>
          <nav>
            {MODES.map((item, index) => (
              <button key={item.id} className={mode === item.id ? "active" : ""} onClick={() => { setMode(item.id); setSelected(null); }}>
                <span className="nav-index">0{index + 1}</span>
                <span><strong>{item.label}</strong><small>{item.kicker}</small></span>
              </button>
            ))}
          </nav>
          <div className="repo-card">
            <div className="repo-icon">GH</div>
            <div><small>SOURCE OF TRUTH</small><strong>alisson92/<br />cloud-native-lab</strong></div>
            <span className="live-dot" />
          </div>
        </aside>

        <section className="stage">
          <div className="stage-heading">
            <div>
              <div className="breadcrumbs"><span>ARCHITECTURE</span><b>/</b><span>{selectedMode.label.toUpperCase()}</span></div>
              <h1>{graph.title}</h1>
              <p>{graph.description}</p>
            </div>
            <div className={`environment-status ${environment}`}>
              <div><span className="pulse-dot" /><strong>{environmentCopy.status}</strong></div>
              <b>{environmentCopy.label}</b>
              <small>{environmentCopy.detail}</small>
            </div>
          </div>

          <div className="canvas-frame" ref={frameRef}>
            <div className="canvas-toolbar">
              <div className="legend"><span><i className="sync" />Synchronous</span><span><i className="async" />Asynchronous</span><span><i className="control" />Control</span></div>
              <div className="canvas-actions">
                <button onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button>
                <button onClick={() => setSpeed(speed === 2 ? 0.5 : speed === 1 ? 2 : 1)}>{speed}×</button>
                <button onClick={() => setZoom(Math.max(0.55, zoom - 0.08))}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(Math.min(1.1, zoom + 0.08))}>＋</button>
                <button onClick={toggleFullscreen} aria-label="Toggle fullscreen">⛶</button>
              </div>
            </div>
            <div className="canvas-viewport">
              <div className={`architecture-canvas ${playing ? "is-playing" : "is-paused"}`} ref={canvasRef} style={{ transform: `scale(${zoom})` }}>
                <div className={`cluster-boundary ${environment}`}>
                  <span>{environment === "kind" ? "KIND CLUSTER · cloud-native-lab" : "GCP · VPC · GKE ZONAL CLUSTER"}</span>
                </div>
                <svg className="connections" viewBox="0 0 1440 820" aria-hidden="true">
                  <defs>
                    {connections.map((edge) => <marker key={`m-${edge.id}`} id={`arrow-${edge.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={edge.color} /></marker>)}
                  </defs>
                  {connections.map((edge) => (
                    <g key={edge.id}>
                      <path id={`path-${edge.id}`} d={edge.path} className={edge.dashed ? "edge dashed" : "edge"} stroke={edge.color} markerEnd={`url(#arrow-${edge.id})`} />
                      {edge.label && <text className="edge-label"><textPath href={`#path-${edge.id}`} startOffset="50%">{edge.label}</textPath></text>}
                      {Array.from({ length: edge.particles ?? 0 }).map((_, index) => (
                        <circle key={index} r={index === 0 ? 5 : 3.5} fill={edge.color} className="particle" style={{ filter: `drop-shadow(0 0 5px ${edge.color})` }}>
                          <animateMotion dur={`${(3.6 + index * 0.35) / speed}s`} begin={`${index * -1.4}s`} repeatCount="indefinite" keyPoints={edge.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear"><mpath href={`#path-${edge.id}`} /></animateMotion>
                        </circle>
                      ))}
                    </g>
                  ))}
                </svg>
                {graph.nodes.map((node) => (
                  <button key={node.id} className={`architecture-node tone-${node.tone} ${selected?.id === node.id ? "selected" : ""}`} style={{ left: node.x, top: node.y, width: node.w ?? 174 }} onClick={() => setSelected(node)}>
                    <span className="node-icon" style={{ color: toneColor[node.tone] }}>{node.icon}</span>
                    <span className="node-copy"><strong>{node.label}</strong><small>{node.subtitle}</small></span>
                    <span className="node-port left" /><span className="node-port right" />
                    {node.status && <em>{node.status}</em>}
                  </button>
                ))}
              </div>
            </div>
            <div className="canvas-caption"><span className="info-icon">i</span>{graph.note}<span className="caption-stat">{graph.nodes.length} components · {graph.edges.length} connections</span></div>
          </div>
        </section>

        <aside className={`detail-panel ${selected ? "open" : ""}`}>
          {selected ? (
            <>
              <button className="close-detail" onClick={() => setSelected(null)}>×</button>
              <span className="detail-kicker">COMPONENT DETAIL</span>
              <div className={`detail-icon tone-${selected.tone}`}>{selected.icon}</div>
              <h2>{selected.label}</h2><p>{selected.subtitle}</p>
              <dl>
                {selected.namespace && <><dt>Namespace</dt><dd>{selected.namespace}</dd></>}
                {selected.type && <><dt>Workload</dt><dd>{selected.type}</dd></>}
                {selected.protocol && <><dt>Interface</dt><dd>{selected.protocol}</dd></>}
                {selected.status && <><dt>Status</dt><dd>{selected.status}</dd></>}
              </dl>
              <div className="detail-description">{selected.detail}</div>
              {selected.source && <div className="source-file"><small>IMPLEMENTATION</small><code>{selected.source}</code></div>}
            </>
          ) : <div className="detail-empty"><span>＋</span><strong>Explore the architecture</strong><p>Select a component to see its namespace, protocol, and implementation.</p></div>}
        </aside>
      </div>
    </main>
  );
}

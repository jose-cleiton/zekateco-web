import React, { useState, useEffect, useRef } from "react";
import { 
  Users, 
  Cpu, 
  Activity, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Clock, 
  UserPlus,
  Shield,
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Globe,
  Copy,
  Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";

interface Device {
  sn: string;
  alias: string;
  last_seen: string;
  ip: string;
  online: boolean;
}

interface User {
  pin: string;
  name: string;
  privilege: number;
  password?: string;
  card?: string;
}

interface Log {
  id: number;
  sn: string;
  pin: string;
  time: string;
  status: number;
  verify_type: number;
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState<Partial<User>>({
    pin: "",
    name: "",
    privilege: 0,
    password: "",
    card: ""
  });

  const [serverUrl, setServerUrl] = useState(window.location.origin);
  const [serverPort, setServerPort] = useState("");

  const ws = useRef<WebSocket | null>(null);

  const fetchData = async () => {
    setServerUrl(window.location.origin);
    try {
      const [devRes, userRes, logRes] = await Promise.all([
        fetch("/api/devices"),
        fetch("/api/users"),
        fetch("/api/logs")
      ]);
      setDevices(await devRes.json());
      setUsers(await userRes.json());
      setLogs(await logRes.json());
      fetch("/api/config").then(r => r.json()).then(cfg => setServerPort(String(cfg.port))).catch(() => {});
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    ws.current = socket;

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "new_log") {
        setLogs(prev => [data.log, ...prev].slice(0, 100));
      } else if (data.type === "device_update" || data.type === "users_updated") {
        fetchData();
      }
    };

    socket.onerror = () => {};

    return () => {
      socket.close();
    };
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      if (res.ok) {
        setShowAddUser(false);
        setNewUser({ pin: "", name: "", privilege: 0, password: "", card: "" });
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (error) {
      console.error("Error adding user:", error);
    }
  };

  const handleDeleteUser = async (pin: string) => {
    if (!confirm("Tem certeza que deseja excluir este usuário?")) return;
    try {
      await fetch(`/api/users/${pin}`, { method: "DELETE" });
      fetchData();
    } catch (error) {
      console.error("Error deleting user:", error);
    }
  };

  const handleSyncUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sync-users", { method: "POST" });
      if (res.ok) {
        alert("Comando de sincronização enviado! Aguarde alguns segundos para os usuários aparecerem.");
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (error) {
      console.error("Error syncing users:", error);
    } finally {
      setLoading(false);
    }
  };

  // Prepare chart data
  const chartData = logs.slice(0, 20).reverse().map(l => ({
    time: new Date(l.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    val: 1
  })).reduce((acc: any[], curr) => {
    const existing = acc.find(a => a.time === curr.time);
    if (existing) existing.val += 1;
    else acc.push(curr);
    return acc;
  }, []);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans p-4 md:p-8">
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white">
              <Shield size={28} />
            </div>
            ZKTeco ADMS Dashboard
          </h1>
          <p className="text-slate-500 mt-1">Gerenciamento de REP Push Protocol</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchData}
            className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
          >
            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
          </button>
          <button 
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
          >
            <UserPlus size={20} />
            Novo Usuário
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Connection Info */}
        <div className="lg:col-span-12">
          <section className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200">
                <Globe size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-indigo-900">Configuração ADMS</h3>
                <p className="text-indigo-700 text-sm">Use estes dados no menu de rede do seu dispositivo ZKTeco</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
              <div className="flex-1 md:flex-none bg-white p-3 rounded-xl border border-indigo-200 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Endereço do Servidor</p>
                  <p className="text-sm font-mono font-bold text-indigo-600">{new URL(serverUrl).hostname}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(new URL(serverUrl).hostname);
                    alert("Copiado!");
                  }}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
                >
                  <Copy size={16} />
                </button>
              </div>

              <div className="flex-1 md:flex-none bg-white p-3 rounded-xl border border-indigo-200">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Porta</p>
                <p className="text-sm font-mono font-bold text-indigo-600">{serverPort || new URL(serverUrl).port || (serverUrl.startsWith('https') ? '443' : '80')}</p>
              </div>
            </div>
          </section>
        </div>
        
        {/* Stats & Devices */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Smartphone size={20} className="text-indigo-600" />
              Dispositivos Conectados
            </h2>
            <div className="space-y-3">
              {devices.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <AlertCircle size={40} className="mx-auto mb-2 opacity-20" />
                  Nenhum dispositivo detectado
                </div>
              ) : (
                devices.map(dev => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={dev.sn} 
                    className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-slate-800">{dev.sn}</p>
                      <p className="text-xs text-slate-500 font-mono">{dev.ip}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      {dev.online ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                          Online
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                          <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                          Offline
                        </span>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        Visto: {dev.last_seen ? new Date(dev.last_seen).toLocaleTimeString() : "-"}
                      </p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </section>

          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Activity size={20} className="text-indigo-600" />
              Atividade Recente
            </h2>
            <div className="h-48 w-full" style={{ minHeight: 192 }}>
              <ResponsiveContainer width="100%" height={192}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="time" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="val" stroke="#6366f1" fillOpacity={1} fill="url(#colorVal)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* Users & Logs */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Users size={20} className="text-indigo-600" />
                Usuários no Sistema
              </h2>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleSyncUsers}
                  disabled={loading || devices.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
                >
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  Sincronizar do REP
                </button>
                <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg">
                  {users.length} Total
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">PIN</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Nome</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Privilégio</th>
                    <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cartão</th>
                    <th className="px-6 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(user => (
                    <tr key={user.pin} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 font-mono text-sm font-medium text-slate-600">{user.pin}</td>
                      <td className="px-6 py-4 font-semibold text-slate-800">{user.name}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded-md font-medium ${user.privilege === 14 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                          {user.privilege === 14 ? 'Admin' : 'Usuário'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{user.card || "-"}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleDeleteUser(user.pin)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Clock size={20} className="text-indigo-600" />
                Logs de Acesso
              </h2>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <div className="divide-y divide-slate-100">
                {logs.map((log, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    key={log.id} 
                    className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500">
                        <Users size={18} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">PIN: {log.pin}</p>
                        <p className="text-xs text-slate-500">SN: {log.sn}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-slate-700">{new Date(log.time).toLocaleString()}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Verificação: {log.verify_type === 1 ? "Digital" : "Senha/Cartão"}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddUser(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 bg-indigo-600 text-white">
                <h3 className="text-xl font-bold">Cadastrar Novo Usuário</h3>
                <p className="text-indigo-100 text-sm">O comando será enviado aos REPs conectados</p>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">PIN / ID</label>
                    <input 
                      required
                      type="text" 
                      value={newUser.pin}
                      onChange={e => setNewUser({...newUser, pin: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      placeholder="Ex: 1001"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Privilégio</label>
                    <select 
                      value={newUser.privilege}
                      onChange={e => setNewUser({...newUser, privilege: parseInt(e.target.value)})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                      <option value={0}>Usuário Comum</option>
                      <option value={14}>Administrador</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Nome Completo</label>
                  <input 
                    required
                    type="text" 
                    value={newUser.name}
                    onChange={e => setNewUser({...newUser, name: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="Nome do colaborador"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Senha (Opcional)</label>
                  <input 
                    type="password" 
                    value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Cartão RFID (Opcional)</label>
                  <input 
                    type="text" 
                    value={newUser.card}
                    onChange={e => setNewUser({...newUser, card: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    placeholder="ID do cartão"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddUser(false)}
                    className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                  >
                    Salvar Usuário
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

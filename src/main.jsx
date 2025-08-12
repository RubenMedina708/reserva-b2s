import "./index.css";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, Ticket, LogIn, LogOut, UploadCloud, CheckCircle2, Info } from "lucide-react";
import QRCode from "qrcode";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { createClient } from "@supabase/supabase-js";

// --- Supabase client ---
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// --- Datos del evento / constantes UI ---
const EVENTO = {
  titulo: "BACK TO SCHOOL PARTY",
  subtitulo: "Fiesta de Bienvenida – Nuevo Ingreso ITSU",
  fecha: "Viernes, 5 de septiembre",
  hora: "9:30 PM",
  lugar: "Dion Fake Life",
  direccion: "C. Hilanderos 97, La Magdalena, Uruapan, Mich.",
  costos: "Preventa: $100 | Día del evento: $150",
  ig: "@cesa.itsu",
};
const PRECIO = 100;
const MAX_ENTRADAS = 40;

const CARRERAS = [
  "Administración",
  "Civil",
  "Electrónica",
  "Industrial",
  "Industrias Alimentarias",
  "Mecánica",
  "Mecatrónica",
  "Sistemas Computacionales",
  "Innovación Agrícola",
];
const SEMESTRES = ["1","2","3","4","5","6","7","8","9","10"];

function limitsFor(tipo) {
  return tipo === "Sala"
    ? { min: 10, max: MAX_ENTRADAS }
    : { min: 3, max: MAX_ENTRADAS }; // Periquera: mínimo 3
}

// --- Provider con sesión Supabase ---
function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Estado local (mientras conectamos reservas a DB)
  const [eventActive, setEventActive] = useState(true);
  const [reservas, setReservas] = useState([]);
  const [myReservaId, setMyReservaId] = useState(null);

  // Cargar sesión actual y escuchar cambios
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (mounted) setSession(data.session ?? null);
      // suscripción a cambios
      const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s ?? null));
      // cleanup
      return () => sub.subscription.unsubscribe();
    })();

    return () => { mounted = false; };
  }, []);

  // Calcular usuario "amigable" desde la sesión
  const user = useMemo(() => {
    const u = session?.user;
    if (!u) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.user_metadata?.name || "",
      verified: !!u.email_confirmed_at,
    };
  }, [session]);

  // Consultar si es admin (tabla public.admins con columna email)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.email) { setIsAdmin(false); return; }
      const { data, error } = await supabase.from("admins").select("email").eq("email", user.email).maybeSingle();
      if (!active) return;
      setIsAdmin(!!data && !error);
    })();
    return () => { active = false; };
  }, [user?.email]);

  // --- Auth API expuesta a la app ---
  const signUp = async (email, password, name) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw error;
  };

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  setSession(null);
  setIsAdmin(false);
  setReservas([]);
  setMyReservaId(null);
  return error || null;
};

  const resendConfirmation = async (email) => {
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw error;
  };

  // --- Lógica de reservas conectada a Supabase ---
  const dbToReserva = (row) => ({
    id: row.id,
    userEmail: row.email,
    nombre: row.nombre || "",
    telefono: row.telefono || "",
    carrera: row.carrera || "",
    semestre: row.semestre || "",
    cantidad: row.cantidad || 0,
    tipo: row.tipo_reserva || "Periquera",
    estado: row.estado || "pendiente",
    confirmadas: row.cantidad || 0,
    restantes: typeof row.restantes === "number" ? row.restantes : (row.cantidad || 0),
    comprobanteUrl: row.comprobante || row.comprobante_url || null,
    qr: row.qr || null,
  });

  const loadMyReserva = async () => {
  if (!user?.email) { setReservas([]); setMyReservaId(null); return; }
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", user.email)
    .order("created_at", { ascending: false });
  if (error) return;
  setReservas((data || []).map(dbToReserva));
  setMyReservaId(null);
};

  const loadAllReservas = async () => {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return;
    setReservas((data || []).map(dbToReserva));
  };

  // Cargar según rol cuando cambie sesión/rol
  useEffect(() => {
    if (!user?.email) { setReservas([]); setMyReservaId(null); return; }
    (isAdmin ? loadAllReservas : loadMyReserva)();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, isAdmin]);

  // Realtime para refrescar listas
  useEffect(() => {
    if (!user) return;
    const chan = supabase
      .channel("users-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "users" }, () => {
        (isAdmin ? loadAllReservas : loadMyReserva)();
      })
      .subscribe();
    return () => { supabase.removeChannel(chan); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, isAdmin]);

  const createReserva = async (payload) => {
    if (!user?.email) throw new Error("Debes iniciar sesión.");
    const { min, max } = limitsFor(payload.tipo);
    const solicitadas = Math.min(max, Math.max(min, Number(payload.cantidad || 1)));
    const total = solicitadas * PRECIO;

    const insertRow = {
      email: user.email,
      nombre: payload.nombre || user.name || "",
      telefono: payload.telefono || "",
      carrera: payload.carrera,              // enum carrera_enum
      semestre: payload.semestre,            // enum semestre_enum
      tipo_reserva: payload.tipo,            // enum tipo_reserva_enum
      cantidad: solicitadas,
      precio_unit: PRECIO,
      total,
      estado: "pendiente",                   // enum estado_pago
      restantes: solicitadas,
      comprobante_url: payload.comprobanteUrl || null,
      evento: EVENTO.titulo,
    };

    const { data, error } = await supabase.from("users").insert(insertRow).select("*").single();
    if (error) throw error;

    const r = dbToReserva(data);
    setMyReservaId(r.id);
    setReservas(prev => [r, ...(prev || [])]);
  };

  const generarQRFor = async (id) => {
    if (!isAdmin) return;
    try {
      const row = reservas.find((r) => r.id === id);
      if (!row) throw new Error("Reserva no encontrada");

      // Datos que irán dentro del QR
      const payload = {
        v: 1,
        id: row.id,
        uid: row.userEmail,
        nombre: row.nombre,
        tipo: row.tipo,
        entradas: row.confirmadas,
        ts: Date.now(),
      };

      // Generar imagen base64 del QR
      const dataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
        width: 320,
        margin: 1,
      });

      // Guardar en BD: marcar como pagado + QR + updated_at
      const { error } = await supabase
        .from("users")
        .update({
          estado: "pagado",
          qr: dataUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id")
        .single();

      if (error) throw error;

      // Refrescar la lista para que se vea el cambio al instante
      await (isAdmin ? loadAllReservas() : loadMyReserva());

      // Feedback rápido
      alert("Pago confirmado y QR generado.");
    } catch (e) {
      console.error("Confirmar pago:", e);
      alert(`No se pudo confirmar el pago: ${e.message || e}`);
    }
  };

  const rejectReserva = async (id) => {
    if (!isAdmin) return;
    const { error } = await supabase
      .from("users")
      .update({ estado: "rechazado", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    (isAdmin ? loadAllReservas : loadMyReserva)();
  };

  const deleteReserva = async (id) => {
    if (!isAdmin) return;
    if (!id) return;
    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", id);
    if (error) throw error;
    (isAdmin ? loadAllReservas : loadMyReserva)();
  };

  const descontarFor = async (id, n) => {
    if (!isAdmin) return;
    const { error } = await supabase.rpc("decrementar_restantes", { p_id: id, p_n: n });
    if (error) throw error;
    (isAdmin ? loadAllReservas : loadMyReserva)();
  };

  const value = {
    // sesión / auth
    session, user, isAdmin, signUp, signIn, signOut, resendConfirmation,
    // evento / reservas
    eventActive, setEventActive,
    reservas, myReservaId,
    createReserva, generarQRFor, rejectReserva, deleteReserva, descontarFor,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// --- UI ---
function Header() {
  const { user, isAdmin, signOut } = useApp();
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="font-extrabold tracking-tight text-indigo-600">CESA ITSU</Link>
        <nav className="ms-2 flex flex-wrap items-center gap-4 text-sm text-neutral-700">
          <Link to="/">Inicio</Link>
          <Link to="/reservar">Reservar</Link>
          <Link to="/mi-boleto">Mi Boleto</Link>
          {isAdmin && (
            <>
              <Link to="/admin">Admin</Link>
              <Link to="/escaner">Escaner</Link>
            </>
          )}
        </nav>
        <div className="ms-auto flex items-center gap-2 text-sm">
          {user ? (
            <>
              <span className="text-neutral-500 hidden sm:inline">
                {user.email}{!user.verified && " · sin verificar"}
              </span>
              <button onClick={signOut} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border hover:bg-neutral-50">
                <LogOut className="w-4 h-4" /> Salir
              </button>
            </>
          ) : (
            <Link to="/auth" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:opacity-90">
              <LogIn className="w-4 h-4" /> Iniciar sesión
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <Header />
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <footer  className="border-t text-center text-xs text-neutral-500 py-6"
  style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        © 2025 CESA – Comité Ejecutivo de la Sociedad de Alumnos · <span className="inline-flex items-center gap-1"><span>📷</span> @cesa.itsu <span className="text-green-600">✔︎</span></span>
      </footer>
    </div>
  );
}

function Inicio() {
  const nav = useNavigate();
  const { user } = useApp();
  const handleCTA = () => { if (!user || !user.verified) nav("/auth"); else nav("/reservar"); };
  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-sm border p-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">🎉 {EVENTO.titulo}</h1>
          <p className="text-neutral-600">🎓 {EVENTO.subtitulo} 🎓</p>
        </div>
        <div className="mt-6 grid md:grid-cols-2 gap-6 items-center">
          <div className="rounded-xl overflow-hidden border">
            <img
              src="/evento.png"
              alt="Back to School Party – Imagen del Evento"
              className="w-full h-64 sm:h-80 object-cover block"
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="space-y-3">
            <p className="flex items-center gap-2"><CalendarDays className="w-5 h-5" /> {EVENTO.fecha} – {EVENTO.hora}</p>
            <p className="flex items-center gap-2"><MapPin className="w-5 h-5" /> {EVENTO.lugar} – {EVENTO.direccion}</p>
            <p className="flex items-center gap-2"><Ticket className="w-5 h-5" /> {EVENTO.costos}</p>
            <div className="text-center pt-2">
              <button onClick={handleCTA} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white hover:opacity-90">¡Reservar mis entradas!</button>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Auth() {
  const { user, signIn, signUp, resendConfirmation } = useApp();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPass, setRegPass] = useState("");
  const [msg, setMsg] = useState("");
  const nav = useNavigate();

  useEffect(() => { if (user?.verified) nav("/reservar"); }, [user?.verified]);

  const doLogin = async () => {
    setMsg("");
    try { await signIn(loginEmail, loginPass); }
    catch (e) { setMsg(e.message); }
  };

  const doRegister = async () => {
    setMsg("");
    try {
      await signUp(regEmail, regPass, regName);
      setMsg("Te enviamos un correo para confirmar tu cuenta.");
    } catch (e) { setMsg(e.message); }
  };

  const resend = async () => {
    try {
      await resendConfirmation(user?.email || loginEmail || regEmail);
      setMsg("Correo de verificación reenviado.");
    } catch (e) { setMsg(e.message); }
  };

  return (
    <Shell>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4">Acceso</h2>
        {!user ? (
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-2">Iniciar sesión</h3>
              <input className="w-full border rounded-lg px-3 py-2 mb-2" placeholder="Correo" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
              <input type="password" className="w-full border rounded-lg px-3 py-2 mb-2" placeholder="Contraseña" value={loginPass} onChange={e => setLoginPass(e.target.value)} />
              <button onClick={doLogin} className="w-full px-3 py-2 rounded-lg bg-neutral-900 text-white">Entrar</button>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Registrarse</h3>
              <input className="w-full border rounded-lg px-3 py-2 mb-2" placeholder="Nombre" value={regName} onChange={e => setRegName(e.target.value)} />
              <input className="w-full border rounded-lg px-3 py-2 mb-2" placeholder="Correo" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
              <input type="password" className="w-full border rounded-lg px-3 py-2 mb-2" placeholder="Contraseña" value={regPass} onChange={e => setRegPass(e.target.value)} />
              <button onClick={doRegister} className="w-full px-3 py-2 rounded-lg bg-indigo-600 text-white">Crear cuenta</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!user.verified && (
              <div className="inline-flex items-center gap-2 text-sm bg-neutral-50 border rounded-lg px-3 py-2">
                <Info className="w-4 h-4" /> Debes verificar tu correo para continuar.
                <button onClick={resend} className="underline ml-2">Reenviar correo</button>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span>Sesión iniciada como</span> <b>{user.email}</b> {user.name && <span>· {user.name}</span>}
            </div>
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-indigo-700">{msg}</p>}
      </div>
    </Shell>
  );
}

function RequireAuth({ children }) {
  const { user } = useApp();
  const loc = useLocation();
  if (!user) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  if (!user.verified) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  return children;
}

// --- Reservar / MiBoleto / Admin / Escaner (idénticos a tu demo, usando user.email) ---
function Reservar() {
  const { user, createReserva } = useApp();
  const nav = useNavigate();
  const [form, setForm] = useState({ nombre: user?.name || "", telefono: "", carrera: CARRERAS[0], semestre: SEMESTRES[0], cantidad: limitsFor("Periquera").min, tipo: "Periquera", comprobanteUrl: null });
  const { min, max } = limitsFor(form.tipo);
  useEffect(() => { setForm(v => ({ ...v, cantidad: Math.min(max, Math.max(min, Number(v.cantidad || 1))) })); }, [form.tipo]);
  const onFile = (f) => { if (!f) return setForm(v => ({ ...v, comprobanteUrl: null })); const reader = new FileReader(); reader.onload = () => setForm(v => ({ ...v, comprobanteUrl: reader.result })); reader.readAsDataURL(f); };
  const onCantidad = (val) => { const n = parseInt(val || "1", 10); setForm(v => ({ ...v, cantidad: Math.min(max, Math.max(min, isNaN(n) ? 1 : n)) })); };
  const submit = async () => {
    try {
      // Sanitiza y valida teléfono (exactamente 10 dígitos)
      const tel = String(form.telefono || '').replace(/\D/g, '').slice(0, 10);
      if (tel.length !== 10) {
        alert('El teléfono debe tener 10 dígitos.');
        return;
      }
      // Verifica que se haya adjuntado el comprobante
      if (!form.comprobanteUrl) {
        alert('Adjunte el comprobante de pago, por favor.');
        return;
      }
      await createReserva({ ...form, telefono: tel });
      nav('/mi-boleto');
    } catch (e) {
      alert(e.message || 'No se pudo crear la reservación');
    }
  };
  const total = (Number(form.cantidad || 1) * PRECIO);
  return (
    <Shell>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4">Formulario de Reservación</h2>
        <div className="rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 p-3 text-sm mb-4"><b>Instrucciones de Pago:</b> Transfiere <b>${total.toLocaleString("es-MX")} MXN</b> a la cuenta CLABE <b>137528105116209401</b> y adjunta tu comprobante.</div>
        <div className="rounded-lg bg-neutral-50 border p-3 text-sm mb-6"><b>Información de reservación:</b><ul className="list-disc ms-6 mt-1"><li>Para <b>Sala</b>, mínimo 10 entradas o más.</li><li>Para <b>Periquera</b>, mínimo 3 entradas o más.</li></ul></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Nombre Completo</label>
            <input className="w-full border rounded-lg px-3 py-2" value={form.nombre} onChange={e => setForm(v => ({ ...v, nombre: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm mb-1">Número Telefónico</label>
            <input
              inputMode="numeric"
              maxLength={10}
              className="w-full border rounded-lg px-3 py-2"
              value={form.telefono}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                setForm(v => ({ ...v, telefono: digits }));
              }}
            />
          </div>
          <div><label className="block text-sm mb-1">Carrera</label><select className="w-full border rounded-lg px-3 py-2" value={form.carrera} onChange={e => setForm(v => ({ ...v, carrera: e.target.value }))}>{CARRERAS.map(c => <option key={c}>{c}</option>)}</select></div>
          <div>
            <label className="block text-sm mb-1">Semestre</label>
            <select className="w-full border rounded-lg px-3 py-2" value={form.semestre} onChange={e => setForm(v => ({ ...v, semestre: e.target.value }))}>
              {SEMESTRES.map(s => <option key={s} value={s}>{s}°</option>)}
            </select>
          </div>
          <div><label className="block text-sm mb-1">Cantidad de Entradas</label><input type="number" min={min} max={max} className="w-full border rounded-lg px-3 py-2" value={form.cantidad} onChange={(e) => onCantidad(e.target.value)} /><p className="text-xs text-neutral-500 mt-1">{form.tipo === "Sala" ? `Mínimo ${min}` : `Entre ${min} y ${max}`}</p></div>
          <div><label className="block text-sm mb-1">Tipo de Reservación</label><select className="w-full border rounded-lg px-3 py-2" value={form.tipo} onChange={e => setForm(v => ({ ...v, tipo: e.target.value }))}><option>Periquera</option><option>Sala</option></select></div>
          <div className="sm:col-span-2"><label className="block text-sm mb-1">Comprobante de Pago</label><div className="flex items-center gap-3"><label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white cursor-pointer"><UploadCloud className="w-4 h-4" /> Seleccionar archivo<input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => onFile(e.target.files?.[0])} /></label><span className="text-sm text-neutral-500 truncate max-w-[60%]">{form.comprobanteUrl ? "Archivo cargado" : "Ningún archivo seleccionado"}</span></div>{form.comprobanteUrl && <div className="mt-3"><img src={form.comprobanteUrl} alt="comprobante" className="max-h-48 rounded border" /></div>}</div>
        </div>
        <div className="pt-6"><button onClick={submit} className="w-full sm:w-auto px-5 py-3 rounded-xl bg-indigo-600 text-white hover:opacity-90">Enviar Reservación</button></div>
      </div>
    </Shell>
  );
}

function MiBoleto() {
  const { reservas, user } = useApp();
  const my = React.useMemo(() => reservas.filter(r => r.userEmail === user?.email), [reservas, user?.email]);
  return (
    <Shell>
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold">Tus Boletos</h2>

        {my.length === 0 ? (
          <div className="bg-white border rounded-2xl p-6 text-center text-neutral-600">
            Aún no has enviado una reservación.
          </div>
        ) : my.map((reserva) => (
          <div key={reserva.id} className="bg-white border rounded-2xl p-6">
            {reserva.estado !== "pagado" ? (
              <>
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-900 p-3 text-sm mb-4">
                  <b>Pago Pendiente</b><br />
                  Tu reservación está siendo revisada. Tu QR aparecerá aquí cuando el pago sea confirmado.
                </div>
                <div className="text-sm">
                  <p><b>Nombre:</b> {reserva.nombre || "—"}</p>
                  <p><b>Tipo:</b> {reserva.tipo}</p>
                  <p><b>Boletos solicitados:</b> {reserva.confirmadas}</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-emerald-600 font-semibold mb-3">¡Pago confirmado! Presenta este QR en el evento.</div>
                <div className="grid place-items-center mb-3">
                  {reserva.qr
                    ? <img src={reserva.qr} alt="qr" className="w-56 h-56 border rounded" />
                    : <div className="w-56 h-56 grid place-items-center border rounded text-neutral-400">Generando...</div>}
                </div>
                <div className="text-sm">
                  <p><b>Reservación:</b> {reserva.nombre || "—"}</p>
                  <p><b>Tipo:</b> {reserva.tipo}</p>
                  <p><b>Disponibles:</b> {reserva.restantes} / {reserva.confirmadas}</p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function AdminPage() {
  const { isAdmin, eventActive, setEventActive, reservas, generarQRFor, rejectReserva, deleteReserva } = useApp();
  const [preview, setPreview] = useState(null);
  if (!isAdmin) return <NotFound />;
  return (
    <Shell>
      <div className="space-y-6">
        <div className="bg-white border rounded-2xl p-6">
          <h2 className="text-2xl font-bold mb-2">Gestión de Evento</h2>
          <p className="text-sm text-neutral-600 mb-4">Evento Actual: {EVENTO.titulo}</p>
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => setEventActive(true)} className="px-4 py-2 rounded-lg bg-green-600 text-white">Activar</button>
            <button onClick={() => setEventActive(false)} className="px-4 py-2 rounded-lg bg-yellow-500 text-white">Desactivar</button>
            <button onClick={() => alert("Demo: eliminaría el evento")} className="px-4 py-2 rounded-lg bg-red-600 text-white">Eliminar</button>
            <span className="text-sm ms-2">Estado: {eventActive ? "activo" : "inactivo"}</span>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-6">
          <h3 className="text-2xl font-bold mb-4">Panel de Reservaciones</h3>
          <div className="grid gap-4">
            {reservas.length === 0 && <div className="text-sm text-neutral-500">Sin reservaciones aún.</div>}
            {reservas.map(r => (
              <div key={r.id} className="grid md:grid-cols-4 gap-3 border rounded-xl p-4">
                <div className="md:col-span-1">
                  <div className="font-semibold">{r.nombre}</div>
                  <div className="text-sm text-neutral-500">{r.userEmail}</div>
                  <div className="text-sm text-neutral-500">Tel: {r.telefono || "—"}</div>
                </div>
                <div className="md:col-span-2 text-sm">
                  <div>{r.carrera} – {r.semestre}°</div>
                  <div>Tipo: <b>{r.tipo}</b></div>
                  <div>Boletos: {r.restantes} / {r.confirmadas}</div>
                  {r.comprobanteUrl && <button className="text-indigo-600 underline mt-1" onClick={() => setPreview(r.comprobanteUrl)}>Ver Comprobante</button>}
                </div>
                <div className="md:col-span-1 flex items-center justify-between md:justify-end gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs ${r.estado === "pendiente" ? "bg-yellow-100 text-yellow-800" : r.estado === "pagado" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{r.estado}</span>
                  <>
                    {r.estado === "pendiente" && (
                      <>
                        <button onClick={() => generarQRFor(r.id)} className="text-indigo-600">Confirmar Pago</button>
                        <button onClick={() => rejectReserva(r.id)} className="text-red-600">Rechazar</button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (confirm("¿Eliminar esta reservación? Esta acción no se puede deshacer.")) {
                          deleteReserva(r.id);
                        }
                      }}
                      className="text-red-700"
                    >
                      Eliminar
                    </button>
                  </>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/50 grid place-items-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-xl p-3 max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <img src={preview} alt="comprobante" className="max-h-[70vh] mx-auto" />
            <div className="text-center pt-2"><button className="px-4 py-2 rounded-lg border" onClick={() => setPreview(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function ScannerPage() {
  const { reservas, descontarFor, isAdmin } = useApp();
  const [scan, setScan] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [cantidadStr, setCantidadStr] = useState("1");
  const [scanning, setScanning] = useState(false);
  const [videoKey, setVideoKey] = useState(0);
  const videoRef = React.useRef(null);
  const controlsRef = React.useRef(null);
  const readerRef = React.useRef(null);

  // Helper para centralizar y apagar la cámara completamente
  const hardStopCamera = () => {
    // Detener flujo desde ZXing (si existe)
    try { controlsRef.current?.stop?.(); } catch {}
    controlsRef.current = null;

    // Detener lector
    try { readerRef.current?.stopContinuousDecode?.(); } catch {}
    try { readerRef.current?.reset?.(); } catch {}
    readerRef.current = null;

    // Apagar cámara del navegador
    const v = videoRef.current;
    const stream = v && v.srcObject;
    if (stream && typeof stream.getTracks === "function") {
      stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    }
    if (v) {
      try { v.pause?.(); } catch {}
      v.srcObject = null;
      try { v.load?.(); } catch {}
    }

    setScanning(false);
    setVideoKey((k) => k + 1); // fuerza remount del <video>
  };

  if (!isAdmin) return <NotFound />;

  useEffect(() => {
    return () => { hardStopCamera(); };
  }, []);

  const startScan = async () => {
    if (scanning) return;
    setScan(null);
    hardStopCamera();
    setScanning(true);
    try {
      // 1) Abrir cámara manualmente para asegurar vista previa
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoEl = videoRef.current;
      if (!videoEl) throw new Error("Video element no disponible");
      videoEl.srcObject = stream;
      try { await videoEl.play(); } catch {}

      // 2) Iniciar ZXing sobre el mismo stream
      readerRef.current = new BrowserMultiFormatReader();
      const controls = await readerRef.current.decodeFromStream(
        stream,
        videoEl,
        (result, err) => {
          if (result) {
            try {
              const obj = JSON.parse(result.getText());
              setScan(obj);
            } catch {
              alert("QR no válido (no es JSON)");
            }
            hardStopCamera();
          }
        }
      );
      controlsRef.current = controls;
    } catch (e) {
      setScanning(false);
      alert("No se pudo abrir la cámara. Revisa permisos y que estés en https.");
    }
  };

  const stopScan = () => { hardStopCamera(); };

  const reserva = useMemo(() => reservas.find(r => r.id === scan?.id), [scan?.id, reservas]);
  useEffect(() => {
    if (reserva) {
      const start = reserva.restantes > 0 ? 1 : 0;
      setCantidad(start);
      setCantidadStr(String(start));
    }
  }, [reserva?.restantes]);

  const max = Math.max(0, reserva?.restantes || 0);

  return (
    <Shell>
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border shadow-sm p-6 text-center">
        <h2 className="text-3xl font-extrabold mb-4">Escanear Códigos QR</h2>

        {!scan ? (
          <div className="space-y-4">
            <div className="rounded-xl border overflow-hidden">
              <video key={videoKey} ref={videoRef} autoPlay className="w-full aspect-video bg-black object-cover" muted playsInline />
            </div>
            <div className="flex items-center justify-center gap-3">
              {!scanning ? (
                <button onClick={startScan} className="px-5 py-3 rounded-xl bg-indigo-600 text-white">Abrir cámara y escanear</button>
              ) : (
                <button onClick={stopScan} className="px-5 py-3 rounded-xl bg-neutral-900 text-white">Detener</button>
              )}
            </div>
            <p className="text-xs text-neutral-500">Nota: en teléfonos requiere <b>https</b> para usar la cámara (o localhost en desktop).</p>
          </div>
        ) : !reserva ? (
          <div className="text-red-600">Reserva no encontrada para el QR proporcionado.</div>
        ) : (
          <div className="text-left space-y-4">
            <div className="rounded-lg bg-neutral-50 border p-4">
              <div className="font-semibold">Reservación: {reserva.nombre}</div>
              <div className="text-sm">Email: {reserva.userEmail}</div>
              <div className="text-sm">Tipo: {reserva.tipo}</div>
              <div className="text-sm">Disponibles: {reserva.restantes} / {reserva.confirmadas}</div>
            </div>
            <div className="rounded-lg border p-4">
              <label className="block text-sm mb-2"><b>Cantidad de personas que entran:</b></label>
              <div className="flex items-center gap-3">
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={max===0}
                  value={max===0 ? "0" : cantidadStr}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setCantidadStr(digits);
                  }}
                  onBlur={() => {
                    if (max===0) return;
                    const n = Math.min(Math.max(parseInt(cantidadStr || "0", 10) || 0, 1), max);
                    setCantidad(n);
                    setCantidadStr(String(n));
                  }}
                  placeholder="1"
                  className="w-28 border rounded-lg px-3 py-2"
                />
                <button
                  disabled={max===0}
                  onClick={async () => {
                    const n = Math.min(parseInt(cantidadStr || "0", 10) || 0, max);
                    if (n < 1) { alert('Ingresa al menos 1'); return; }
                    await descontarFor(reserva.id, n);
                    const remaining = (reserva?.restantes || 0) - n;
                    if (remaining <= 0) {
                      hardStopCamera();
                      setScan(null);
                    } else {
                      setScan(null);
                      setCantidadStr("1");
                      setTimeout(() => startScan(), 150);
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-40"
                >
                  Aceptar
                </button>
                <button
                  onClick={() => {
                    hardStopCamera();
                    setScan(null);
                    setCantidadStr("1");
                    setTimeout(() => startScan(), 150);
                  }}
                  className="px-4 py-2 rounded-lg border"
                >
                  Escanear otro
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-2">Al aceptar, se descuentan del total. Cuando llegue a 0, el QR queda sin entradas disponibles.</p>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function NotFound() { return <Shell><div className="text-center text-neutral-600">404 – Página no encontrada</div></Shell>; }

function AppRoutes() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/reservar" element={<RequireAuth><Reservar /></RequireAuth>} />
          <Route path="/mi-boleto" element={<RequireAuth><MiBoleto /></RequireAuth>} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/escaner" element={<ScannerPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<AppRoutes />);

export default AppRoutes;
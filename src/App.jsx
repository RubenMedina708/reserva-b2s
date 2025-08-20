import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

// Crea el cliente desde variables de entorno (Vite)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseAnonKey)

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [msg, setMsg] = useState('')

  // Disminuye el cooldown cada segundo
  useEffect(() => {
    if (!cooldown) return
    const t = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  function startCooldown(sec = 60) {
    setCooldown(sec)
  }

  function errorLooksLikeDuplicate(err) {
    const m = (err?.message || '').toLowerCase()
    return m.includes('duplicate key') || m.includes('users_email_partial_key') || m.includes('23505')
  }

  function errorLooksLikeCooldown(err) {
    const m = (err?.message || '').toLowerCase()
    return err?.status === 429 || m.includes('only request this after') || m.includes('too many requests')
  }

  async function onSignUp(e) {
    e.preventDefault()
    if (loading || cooldown > 0) return

    if (!email) {
      setMsg('Ingresa un correo válido.')
      return
    }
    if (!password || password.length < 6) {
      setMsg('La contraseña debe tener al menos 6 caracteres.')
      return
    }

    setLoading(true)
    setMsg('')
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin }
      })

      if (error) {
        if (errorLooksLikeCooldown(error)) {
          setMsg('Espera ~60 segundos antes de volver a intentarlo (protección anti‑abuso).')
          startCooldown(60)
          return
        }
        if (errorLooksLikeDuplicate(error)) {
          setMsg('Ese correo ya está registrado. Inicia sesión o usa "Olvidé mi contraseña".')
          return
        }
        setMsg(error.message || 'Ocurrió un error al crear tu cuenta.')
        return
      }

      if (data?.user) {
        setMsg('¡Listo! Te enviamos un correo para confirmar tu cuenta. Revisa tu bandeja y SPAM.')
        startCooldown(60)
        setEmail('')
        setPassword('')
      }
    } catch (err) {
      setMsg('Error inesperado. Intenta de nuevo en un momento.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 16 }}>
      <h1>CESA ITSU — Registro</h1>
      <p style={{ opacity: 0.8, marginTop: -8 }}>
        Crea tu cuenta para reservar. Por seguridad, puedes reenviar/solicitar de nuevo cada 60 s.
      </p>

      <form onSubmit={onSignUp} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Correo electrónico</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            required
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            required
          />
        </label>

        <button type="submit" disabled={loading || cooldown > 0}>
          {loading ? 'Enviando…' : cooldown > 0 ? `Espera ${cooldown}s` : 'Crear cuenta'}
        </button>
      </form>

      {msg && (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          {msg}
        </div>
      )}

      {!supabaseUrl || !supabaseAnonKey ? (
        <p style={{ marginTop: 16, color: '#b91c1c' }}>
          ⚠️ Faltan variables de entorno VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY.
        </p>
      ) : null}
    </div>
  )
}

export default App

import { useState } from 'react'
import { supabase } from '@/services/supabase-service'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2, Mail, Chrome } from 'lucide-react'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOAuthLoading] = useState<string | null>(null)
  const [isSignUp, setIsSignUp] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: authError } = isSignUp
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

      if (authError) {
        setError(authError.message)
      }
    } catch (err) {
      setError('Erro ao autenticar')
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (provider: 'google' | 'facebook') => {
    setError('')
    setOAuthLoading(provider)

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (oauthError) {
        setError(oauthError.message)
      }
    } catch (err) {
      setError(`Erro ao conectar com ${provider === 'google' ? 'Google' : 'Meta'}`)
    } finally {
      setOAuthLoading(null)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (!email) {
        setError('Digite seu email para resetar a senha')
        return
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        setError(resetError.message)
      } else {
        setResetSent(true)
      }
    } catch (err) {
      setError('Erro ao enviar email de reset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ads Manager</CardTitle>
          <CardDescription>
            {isForgotPassword
              ? 'Resete sua senha'
              : isSignUp
              ? 'Crie sua conta'
              : 'Faça login para continuar'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isForgotPassword ? (
            // Forgot Password Form
            <form onSubmit={handleForgotPassword} className="space-y-4">
              {resetSent ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-600 font-medium mb-2">✓ Email enviado!</p>
                  <p className="text-sm text-green-600">
                    Verifique seu email para o link de reset de senha.
                    O link expira em 1 hora.
                  </p>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-600">{error}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium mb-1">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                    Enviar Link de Reset
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(false)
                  setResetSent(false)
                  setEmail('')
                  setError('')
                }}
                className="w-full text-sm text-blue-600 hover:text-blue-700 py-2"
              >
                Voltar para login
              </button>
            </form>
          ) : (
            // Login / Signup Form
            <form onSubmit={handleAuth} className="space-y-4">
            {error && (
              <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || oauthLoading !== null}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSignUp ? 'Criar Conta' : 'Login'}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Ou continue com</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleOAuth('google')}
                disabled={oauthLoading !== null}
                className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm disabled:opacity-50"
              >
                {oauthLoading === 'google' && <Loader2 className="w-4 h-4 animate-spin" />}
                {oauthLoading !== 'google' && <Chrome className="w-4 h-4" />}
                Google
              </button>

              <button
                type="button"
                onClick={() => handleOAuth('facebook')}
                disabled={oauthLoading !== null}
                className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm disabled:opacity-50"
              >
                {oauthLoading === 'facebook' && <Loader2 className="w-4 h-4 animate-spin" />}
                {oauthLoading !== 'facebook' && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                )}
                Meta
              </button>
            </div>

            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="flex-1 text-blue-600 hover:text-blue-700 py-2"
              >
                {isSignUp ? 'Já tem conta? Faça login' : 'Não tem conta? Crie uma'}
              </button>
              {!isSignUp && (
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(true)}
                  className="flex-1 text-blue-600 hover:text-blue-700 py-2"
                >
                  Esqueci minha senha
                </button>
              )}
            </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

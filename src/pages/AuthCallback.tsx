import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/services/supabase-service'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // O Supabase já processa o callback automaticamente
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error) {
          setError(error.message)
          setTimeout(() => navigate('/'), 3000)
          return
        }

        if (session) {
          // Redirecionar para dashboard após login bem-sucedido
          navigate('/dashboard')
        } else {
          setError('Falha ao autenticar. Tente novamente.')
          setTimeout(() => navigate('/'), 3000)
        }
      } catch (err) {
        setError('Erro ao processar autenticação')
        setTimeout(() => navigate('/'), 3000)
      } finally {
        setLoading(false)
      }
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        {loading && (
          <>
            <div className="mb-4">
              <div className="inline-block animate-spin">
                <svg className="w-8 h-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
            <p className="text-gray-600">Finalizando autenticação...</p>
          </>
        )}

        {error && (
          <>
            <div className="mb-4 text-red-600">
              <svg className="w-8 h-8 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-600">{error}</p>
            <p className="text-sm text-gray-500 mt-2">Redirecionando...</p>
          </>
        )}
      </div>
    </div>
  )
}

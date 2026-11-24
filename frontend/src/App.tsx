import { BaseStyles, ThemeProvider } from '@primer/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './api/queryClient.ts'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Shell } from './app/Shell.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'

const queryClient = createQueryClient()

function App() {
  return (
    <ThemeProvider colorMode="night" nightScheme="dark">
      <BaseStyles style={{ height: '100%' }}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={null} />
                <Route path="card/:id" element={null} />
                <Route path="graph" element={null} />
                <Route path="chat/:id" element={null} />
                <Route path="branches/:id" element={null} />
                <Route path="settings" element={null} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </BaseStyles>
    </ThemeProvider>
  )
}

export default App

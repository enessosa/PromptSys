import { BaseStyles } from '@primer/react'
import { BrowserRouter, Route, Routes } from 'react-router'
import ChatPage from './pages/ChatPage'
import NotFoundPage from './pages/NotFoundPage'

function App() {
  return (
    <BaseStyles>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </BaseStyles>
  )
}

export default App

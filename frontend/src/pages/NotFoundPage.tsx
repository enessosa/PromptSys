import { Heading, Link } from '@primer/react'
import { Link as RouterLink } from 'react-router'

function NotFoundPage() {
  return (
    <main>
      <Heading as="h1">Page not found</Heading>
      <Link as={RouterLink} to="/">Back to chat</Link>
    </main>
  )
}

export default NotFoundPage

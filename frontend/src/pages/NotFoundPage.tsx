import { Heading, Link } from '@primer/react'
import { Link as RouterLink } from 'react-router'

function NotFoundPage() {
  return (
    <main style={{ padding: 24 }}>
      <Heading as="h1">Page not found</Heading>
      <Link as={RouterLink} to="/">Back to the workspace</Link>
    </main>
  )
}

export default NotFoundPage

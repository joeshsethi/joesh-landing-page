import { ExternalLink } from 'lucide-react'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <span className="footer-name">Joesh Sethi</span>
          {/* TODO: Update LinkedIn URL when confirmed */}
          <a
            href="https://linkedin.com/in/joeshsethi"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-social"
            aria-label="LinkedIn"
          >
            <ExternalLink size={18} />
          </a>
        </div>
        <p className="footer-tagline">Built with intention. Deployed with purpose.</p>
        <p className="footer-copy">&copy; {new Date().getFullYear()} Joesh Sethi. All rights reserved.</p>
      </div>
    </footer>
  )
}

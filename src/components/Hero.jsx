import { useEffect, useState } from 'react'
import { ArrowDown, Briefcase } from 'lucide-react'
import './Hero.css'

export default function Hero() {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <section className="hero" id="hero">
      <div className="hero-inner">
        <div className={`hero-content ${loaded ? 'hero-content--visible' : ''}`}>
          <h1 className="hero-name">Joesh Sethi</h1>
          <p className="hero-tagline">From Ideation to Deployment.</p>
          <span className="hero-divider" />
          <p className="hero-sub">
            Technology Architect & AI Consultant — helping teams and businesses
            move faster with technology that actually makes sense.
          </p>
          <div className="hero-ctas">
            <a href="#contact" className="btn btn-primary">
              <Briefcase size={16} />
              Let's Work Together
            </a>
            <a href="#work" className="btn btn-secondary">
              See My Work
              <ArrowDown size={16} />
            </a>
          </div>
        </div>

        {/* TODO: Add hero-visual back when a headshot photo is available */}
      </div>
    </section>
  )
}

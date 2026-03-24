import { useReveal } from '../hooks/useReveal'
import { Leaf, Languages } from 'lucide-react'
import './About.css'

function BasketballIcon({ size = 20, strokeWidth = 1.5 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2v20" />
      <path d="M4.93 4.93c4.08 2.52 4.08 11.62 0 14.14" />
      <path d="M19.07 4.93c-4.08 2.52-4.08 11.62 0 14.14" />
    </svg>
  )
}

const traits = [
  { icon: Leaf, label: 'Tea Ceremony Certified' },
  { icon: BasketballIcon, label: 'Youth Basketball Coach' },
  { icon: Languages, label: 'Fluent in Japanese' },
]

export default function About() {
  const sectionRef = useReveal()
  const traitsRef = useReveal(0.2)

  return (
    <section className="section about" id="about">
      <div className="section-inner">
        <div className="about-grid">
          <div className="about-text reveal" ref={sectionRef}>
            <span className="section-label">About</span>
            <h2 className="section-title">
              Where Technical Depth<br />Meets Human Connection
            </h2>
            <div className="about-body">
              <p>
                I grew up between cultures. Born to an Indian family, raised
                in Kobe, Japan, educated across Prague, New York, and Los Angeles —
                I learned early that the best ideas come from the most unexpected
                intersections.
              </p>
              <p>
                That perspective shaped everything about how I work. For four years
                at Accenture's Innovation Garage, I was the person in the room
                translating between engineers and executives — building AI
                proof-of-concepts in the morning, then demoing them to C-suite
                stakeholders in the afternoon. I helped teams at Fannie Mae, Comcast,
                NBCUniversal, and the New York State Common Retirement Fund see what was possible
                with technology — and then made it real.
              </p>
              <p className="about-closer">
                I've spent my career sitting at the table between the people who
                build technology and the people who need it. That's exactly where
                I want to be.
              </p>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}

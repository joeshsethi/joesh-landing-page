import { useReveal } from '../hooks/useReveal'
import { ExternalLink } from 'lucide-react'
import './Experience.css'

const roles = [
  {
    company: 'Accenture',
    role: 'Technology Architect',
    location: 'Philadelphia, PA',
    dates: '2021 — 2025',
    desc: 'Built and demoed Gen AI proof-of-concepts at the Innovation Garage. Led design thinking workshops with C-suite executives across Fortune 500 clients.',
  },
  {
    company: 'Eli Lilly',
    role: 'IT Intern',
    location: 'Kobe, Japan',
    dates: '2019',
    desc: 'International internship supporting IT operations at one of the world\'s largest pharmaceutical companies.',
  },
  {
    company: 'ThreadBeast',
    role: 'Operations & Growth',
    location: 'Los Angeles, CA',
    dates: '2018 — 2019',
    desc: 'Helped scale a subscription fashion startup — logistics, operations, and customer growth.',
  },
  {
    company: 'New York University',
    role: 'B.A. Computer Science',
    location: 'New York, NY',
    dates: '2017 — 2021',
    desc: 'Studied Computer Science with a global perspective — semester abroad in Prague.',
  },
]

export default function Experience() {
  const titleRef = useReveal()
  const listRef = useReveal(0.1)

  return (
    <section className="section experience" id="experience">
      <div className="section-inner">
        <div className="reveal" ref={titleRef}>
          <span className="section-label">Experience</span>
          <h2 className="section-title">Where I've Been</h2>
        </div>

        <div className="exp-list reveal" ref={listRef}>
          {roles.map(({ company, role, location, dates, desc }) => (
            <div className="exp-item" key={company}>
              <div className="exp-left">
                <span className="exp-dates">{dates}</span>
                <span className="exp-location">{location}</span>
              </div>
              <div className="exp-right">
                <h3 className="exp-company">{company}</h3>
                <span className="exp-role">{role}</span>
                <p className="exp-desc">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="exp-cta reveal" ref={useReveal()}>
          <p>Want the full picture?</p>
          {/* TODO: Update LinkedIn URL when confirmed */}
          <a
            href="https://linkedin.com/in/joeshsethi"
            target="_blank"
            rel="noopener noreferrer"
            className="exp-linkedin"
          >
            <ExternalLink size={16} />
            Let's connect on LinkedIn
          </a>
        </div>
      </div>
    </section>
  )
}

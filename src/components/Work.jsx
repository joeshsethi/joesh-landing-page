import { useReveal } from '../hooks/useReveal'
import { TrendingUp } from 'lucide-react'
import './Work.css'

const projects = [
  {
    title: 'AI Commercial Ad Creation Tool',
    client: 'NBCUniversal / Peacock',
    desc: 'A tool that automatically creates video ads tailored to each viewer — so businesses reach the right people with the right message, automatically.',
    stat: 'Built for Fortune 100 media',
    tags: ['Claude AI', 'Stable Diffusion', 'Azure', 'Python'],
  },
  {
    title: 'Salesforce Product Recommendation Copilot',
    client: 'Accenture Innovation Garage',
    desc: 'An AI sales assistant that listens to your customer and tells your staff exactly what to recommend — like having an expert whispering in your ear.',
    stat: 'Real-time voice AI',
    tags: ['OpenAI Realtime API', 'Pinecone', 'Vector Search'],
  },
  {
    title: 'Fannie Mae Quality Engineering Assessment',
    client: 'Fannie Mae',
    desc: 'Helped one of America\'s largest mortgage companies identify exactly where they were losing time and money — and fix it.',
    stat: '$500K deal secured',
    tags: ['Stakeholder Management', 'Executive Strategy', '5 Verticals'],
  },
]

const stats = [
  { value: '$500K', label: 'Implementation deal secured' },
  { value: '$200M+', label: 'Sales relationships maintained' },
  { value: '$1B/mo', label: 'System scale managed' },
  { value: '500K', label: 'People impacted' },
  { value: '$200K+', label: 'Annual costs eliminated' },
  { value: '4 Yrs', label: 'Enterprise AI experience' },
]

export default function Work() {
  const titleRef = useReveal()
  const cardsRef = useReveal(0.1)
  const statsRef = useReveal(0.1)

  return (
    <section className="section work" id="work">
      <div className="section-inner">
        <div className="reveal" ref={titleRef}>
          <span className="section-label">The Work</span>
          <h2 className="section-title">What I've Built</h2>
          <p className="section-subtitle">
            A few highlights from building and shipping AI at enterprise scale.
          </p>
        </div>

        <div className="work-grid reveal reveal-stagger" ref={cardsRef}>
          {projects.map(({ title, client, desc, stat, tags }) => (
            <div className="work-card" key={title}>
              <span className="work-client">{client}</span>
              <h3 className="work-title">{title}</h3>
              <p className="work-desc">{desc}</p>
              <div className="work-stat">
                <TrendingUp size={14} />
                {stat}
              </div>
              <div className="work-tags">
                {tags.map(tag => (
                  <span className="work-tag" key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="stats-strip reveal reveal-stagger" ref={statsRef}>
          {stats.map(({ value, label }) => (
            <div className="stat-item" key={label}>
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

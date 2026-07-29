import { ArrowIcon, DocumentIcon } from "@/components/brand-asset/brand-icons";
import { BrandSidebar } from "@/components/brand-asset/brand-sidebar";
import { ContrastCard } from "@/components/brand-asset/contrast-card";
import { GradientTile } from "@/components/brand-asset/gradient-tile";
import { MisuseVisual } from "@/components/brand-asset/misuse-visual";
import { PaletteColumn } from "@/components/brand-asset/palette-column";
import { MagmosMark } from "@/components/brand-asset/magmos-mark";
import { TechnicalVisual } from "@/components/brand-asset/technical-visual";
import {
  ORANGE_SCALE,
  CONTRAST_CARDS,
  GRAY_SCALE,
  MISUSE_CARDS,
} from "./data";

function BrandPager() {
  return (
    <footer className="brand-pager">
      <button type="button">
        <ArrowIcon direction="left" />
        Previous
      </button>
      <button type="button">
        Next
        <ArrowIcon direction="right" />
      </button>
    </footer>
  );
}

export default function BrandAssetPage() {
  return (
    <main className="brand-page">
      <BrandSidebar />
      <article className="brand-content">

        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="brand-hero">
          <MagmosMark light />
          <h1>Magmos Brand Guidelines</h1>
        </section>

        {/* ── Color intro ──────────────────────────────────────── */}
        <section className="brand-intro brand-section" id="core-color-palette">
          <h2>Color</h2>
          <p>
            Color defines our brand&apos;s emotional tone and visual presence. A consistent palette
            strengthens recognition, creates harmony across materials, and helps communicate our
            values with immediacy and impact.
          </p>
        </section>

        {/* ── Core palette ─────────────────────────────────────── */}
        <section className="brand-section brand-two-col">
          <h2>Core Color Palette</h2>
          <div>
            <p>
              The following values make up our core palette. These colors are used most frequently
              and should be prioritized when working with a limited color range.
            </p>
            <div className="brand-core-swatches">
              <div className="brand-core-blue">
                <pre>{`Name:  Magmos Orange 500\nCMYK:  0/72/95/0\nRGB:   255/106/26\nHEX:   #FF6A1A\nPMS:   1655 C`}</pre>
              </div>
              <div className="brand-core-black">
                <pre>{`Name:  Black\nCMYK:  0/0/0/100\nRGB:   0/0/0\nHEX:   #000000\nPMS:   Black 6C C`}</pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── Extended palette ─────────────────────────────────── */}
        <section className="brand-section brand-two-col" id="extended-palette">
          <h2>Extended Palette</h2>
          <div>
            <p>
              The extended palette of our core colors provides flexibility across multiple touchpoints,
              including web, diagrams, and illustrations.
            </p>
            <div className="brand-palette-grid">
              <PaletteColumn colors={ORANGE_SCALE} />
              <PaletteColumn colors={GRAY_SCALE} />
            </div>
          </div>
        </section>

        {/* ── Accessibility ────────────────────────────────────── */}
        <section className="brand-section brand-accessibility" id="accessibility">
          <h2>Accessibility</h2>
          <div>
            <p>
              On the website and in interactive applications, color usage must meet accessibility
              contrast requirements. While we aim for AAA, our minimum requirement is AA. Do not use
              any color pairings that fail to meet the AA standard.
            </p>
            <p>
              While we aim for AAA, our minimum requirement is AA. Do not use any color pairings
              that fail to meet the AA standard.
            </p>
            <p>See examples below.</p>
            <div className="brand-contrast-grid">
              {CONTRAST_CARDS.map((card) => (
                <ContrastCard card={card} key={`${card.left}-${card.right}`} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Incorrect usage ──────────────────────────────────── */}
        <section className="brand-section brand-incorrect" id="incorrect-usage">
          <h2>Incorrect Usage</h2>
          <div>
            <p>Do not diminish the value of color in the brand. Avoid the following uses.</p>
            <div className="brand-misuse-grid">
              {MISUSE_CARDS.map((card) => (
                <div className="brand-misuse-card" key={card.label}>
                  <MisuseVisual type={card.type} />
                  <b>x</b>
                  <span>{card.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <BrandPager />

        {/* ── Gradients intro ──────────────────────────────────── */}
        <section className="brand-section brand-gradient-intro" id="primary-gradient">
          <h2>Gradients</h2>
          <div>
            <p>
              Gradients add depth, energy, and modernity to our visual expression. When used
              intentionally, they enhance focus, highlight key elements, and create a distinctive
              sense of motion and dimension for our brand.
            </p>
            <button className="brand-download-inline" type="button">
              Download All
              <DocumentIcon />
            </button>
          </div>
        </section>

        {/* ── Primary gradient ─────────────────────────────────── */}
        <section className="brand-section brand-gradient-section">
          <h2>Primary Gradient</h2>
          <div>
            <p>
              Our primary gradient uses only Magmos Orange 500, white, and black. We add grain for
              texture and depth, then finish it with a warm overlay to bring it closer to Magmos Orange 500.
            </p>
            <GradientTile variant="primary" />
          </div>
        </section>

        {/* ── Secondary gradient ───────────────────────────────── */}
        <section className="brand-section brand-gradient-section" id="secondary-gradient">
          <h2>Secondary Gradient</h2>
          <div>
            <div className="brand-copy-pair">
              <p>
                Our secondary gradient is an extension of our primary gradient.
                <br />
                <br />
                It is designed to express Magmos&apos;s fast, fluid, and fundamentally different nature.
                The fluctuation in the gradient conveys a sense of speed and forward motion.
              </p>
              <p>
                We will use these gradients intentionally and balance them with other design elements
                so they highlight the system&apos;s sophistication without overpowering the overall design.
              </p>
            </div>
            <div className="brand-gradient-grid">
              <GradientTile variant="orb" />
              <GradientTile variant="stripes" />
              <GradientTile variant="bands" />
              <GradientTile variant="stairs" />
            </div>
          </div>
        </section>

        <BrandPager />

        {/* ── Technical visuals intro ──────────────────────────── */}
        <section className="brand-section brand-technical-intro" id="illustrations">
          <h2>Technical Visuals</h2>
          <p>
            Illustrations and diagrams should be precise, clear, and purposeful, helping audiences
            grasp concepts quickly while maintaining a cohesive brand style.
          </p>
        </section>

        {/* ── Illustrations ────────────────────────────────────── */}
        <section className="brand-section brand-technical-section">
          <h2>Illustrations</h2>
          <div>
            <div className="brand-copy-pair">
              <p>
                Our illustrations are technical and sleek. They rely primarily on line work in a range
                of greys, with blue as an accent. Shapes are clean and structural, combining line work
                with simple planes when needed.
              </p>
              <p>
                Text can be used as a supportive element to clarify complex or abstract concepts,
                especially for our primitives. Overall, the style should feel clear, informative, and
                easy to read at a glance.
              </p>
            </div>
            <div className="brand-technical-grid">
              <TechnicalVisual variant="rings" />
              <TechnicalVisual variant="cube" />
              <TechnicalVisual variant="cube" />
              <TechnicalVisual variant="rings" />
            </div>
          </div>
        </section>

        {/* ── Diagrams ─────────────────────────────────────────── */}
        <section className="brand-section brand-technical-section" id="diagrams">
          <h2>Diagrams</h2>
          <div>
            <div className="brand-copy-pair">
              <p>
                Our diagrams follow the same look and feel as our illustrations: technical, sleek, and
                line driven. They use a mix of line types such as dotted and solid, with blue as an
                accent. Direction should be clearly communicated with arrows so the flow is easy to
                understand.
              </p>
              <p>
                Icons are used only when they help clarify the concept. Clear hierarchy and strong
                legibility are essential and remain the primary focus of every diagram.
              </p>
            </div>
            <TechnicalVisual variant="diagram" />
          </div>
        </section>

        <BrandPager />

        {/* ── Contact / Media Kit ──────────────────────────────── */}
        <section className="brand-contact-section" id="contact-us">
          <div className="brand-contact-copy">
            <h2>Media Kit</h2>
            <div>
              <p>
                For any questions, clarifications, or feedback on these brand guidelines, please
                reach out to us. We&apos;re here to support you and ensure our brand is expressed
                consistently and confidently.
              </p>
              <div className="brand-contact-actions">
                <button type="button">
                  Media Inquiries
                  <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none">
                    <path d="M4 9h16v10H4V9Zm3-4h10l1 4H6l1-4Z" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8 14h8M12 10v8" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                </button>
                <button type="button">
                  Download Media Kit
                  <DocumentIcon />
                </button>
              </div>
            </div>
          </div>
          <div className="brand-contact-pager">
            <button type="button">
              <ArrowIcon direction="left" />
              Previous
            </button>
            <button disabled type="button">
              Next
              <ArrowIcon direction="right" />
            </button>
          </div>
        </section>

      </article>
    </main>
  );
}

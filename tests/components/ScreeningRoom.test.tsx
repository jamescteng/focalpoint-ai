import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreeningRoom } from '../../components/ScreeningRoom';
import { Project, AgentReport, Persona } from '../../types';

const mockPersona: Persona = {
  id: 'cultural_editor',
  name: 'Cultural Editor',
  role: 'Cultural Relevance Specialist',
  description: 'Focuses on cultural resonance and emotional authenticity',
  instruction: 'Analyze cultural elements',
  avatar: '/avatar.jpg',
  color: '#E91E63',
  focusAreas: ['Cultural relevance', 'Emotional resonance'],
  demographics: {
    age: '45-55',
    segment: 'Cultural professionals',
    tastes: ['World cinema', 'Documentary'],
    background: 'Film studies background',
  },
};

const mockReport: AgentReport = {
  personaId: 'cultural_editor',
  executive_summary: 'This is a test summary that is long enough to demonstrate the display functionality.',
  highlights: [
    {
      timestamp: '02:30',
      seconds: 150,
      summary: 'Great scene',
      why_it_works: 'Emotional impact',
      category: 'emotion',
    },
    {
      timestamp: '05:00',
      seconds: 300,
      summary: 'Another highlight',
      why_it_works: 'Visual excellence',
      category: 'craft',
    },
  ],
  concerns: [
    {
      timestamp: '10:00',
      seconds: 600,
      issue: 'Pacing issue',
      impact: 'Loses audience attention',
      severity: 3,
      category: 'pacing',
      suggested_fix: 'Tighten the edit',
    },
  ],
  answers: [
    {
      question: 'Is the story clear?',
      answer: 'Yes, the narrative is well-structured.',
    },
  ],
};

const mockProject: Project = {
  id: 'test-project-1',
  title: 'Test Film',
  synopsis: 'A test film synopsis',
  videoUrl: 'blob:http://localhost/test-video',
  questions: ['Is the story clear?'],
  language: 'en',
  selectedPersonaIds: ['cultural_editor'],
  videoFingerprint: {
    fileName: 'test-film.mp4',
    fileSize: 100 * 1024 * 1024,
    lastModified: 1234567890,
  },
};

const mockProjectNoVideo: Project = {
  ...mockProject,
  videoUrl: undefined,
  videoFile: undefined,
};

const mockAvailablePersonas: Persona[] = [
  {
    id: 'acquisitions_director',
    name: 'Acquisitions Director',
    role: 'Acquisitions',
    description: 'Commercial focus',
    instruction: 'Analyze commercial potential',
    avatar: '/avatar2.jpg',
    color: '#2196F3',
    demographics: {
      age: '35-45',
      segment: 'Industry professionals',
      tastes: ['Commercial films'],
      background: 'Distribution background',
    },
  },
];

describe('ScreeningRoom', () => {
  let onAddPersona: ReturnType<typeof vi.fn>;
  let onVideoReattach: ReturnType<typeof vi.fn>;
  let onUpdateReportAnswers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAddPersona = vi.fn();
    onVideoReattach = vi.fn();
    onUpdateReportAnswers = vi.fn();
  });

  it('renders the screening room with report data', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.getByText('Test Film')).toBeInTheDocument();
    expect(screen.getByText('Cultural Editor')).toBeInTheDocument();
  });

  it('displays the executive summary tab by default', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.getByText(/this is a test summary/i)).toBeInTheDocument();
  });

  it('switches to highlights tab when clicked', async () => {
    const user = userEvent.setup();
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const highlightsTab = screen.getByRole('button', { name: /highlights/i });
    await user.click(highlightsTab);

    expect(screen.getByText('Great scene')).toBeInTheDocument();
    expect(screen.getByText('02:30')).toBeInTheDocument();
  });

  it('switches to concerns tab when clicked', async () => {
    const user = userEvent.setup();
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const concernsTab = screen.getByRole('button', { name: /concerns/i });
    await user.click(concernsTab);

    expect(screen.getByText('Pacing issue')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('displays video player when videoUrl is present', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', mockProject.videoUrl);
  });

  it('shows "Video Not Attached" UI when videoUrl is missing', () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.getByText(/video not attached/i)).toBeInTheDocument();
    expect(screen.getByText(/attach local file/i)).toBeInTheDocument();
  });

  it('triggers file picker when attach video button is clicked', async () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const attachButton = screen.getByText(/attach local file/i);
    expect(attachButton).toBeInTheDocument();
  });

  it('calls onVideoReattach when matching file is selected', async () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const file = new File(['video content'], 'test-film.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });
    Object.defineProperty(file, 'lastModified', { value: 1234567890 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [file] } });

    expect(onVideoReattach).toHaveBeenCalledWith(file, 'blob:mock-url');
  });

  it('shows fingerprint mismatch warning for mismatched file', async () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const wrongFile = new File(['video content'], 'wrong-file.mp4', { type: 'video/mp4' });
    Object.defineProperty(wrongFile, 'size', { value: 200 * 1024 * 1024 });
    Object.defineProperty(wrongFile, 'lastModified', { value: 9999999999 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [wrongFile] } });

    expect(screen.getByText(/file mismatch/i)).toBeInTheDocument();
    expect(onVideoReattach).not.toHaveBeenCalled();
  });

  it('allows proceeding with mismatched file when "Use Anyway" is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const wrongFile = new File(['video content'], 'wrong-file.mp4', { type: 'video/mp4' });
    Object.defineProperty(wrongFile, 'size', { value: 200 * 1024 * 1024 });
    Object.defineProperty(wrongFile, 'lastModified', { value: 9999999999 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [wrongFile] } });

    const useAnywayButton = screen.getByText(/use anyway/i);
    await user.click(useAnywayButton);

    expect(onVideoReattach).toHaveBeenCalledWith(wrongFile, 'blob:mock-url');
  });

  it('shows Add Reviewer button when personas are available', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.getByText(/add reviewer/i)).toBeInTheDocument();
  });

  it('hides Add Reviewer button when no personas are available', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={[]}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.queryByText(/add reviewer/i)).not.toBeInTheDocument();
  });

  it('shows analyzing state when isAnalyzing is true', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={true}
        analyzingPersonaId="acquisitions_director"
        statusMessage="Analyzing with Acquisitions Director..."
      />
    );

    expect(screen.getByText(/analyzing with acquisitions director/i)).toBeInTheDocument();
  });

  it('calls onAddPersona when a persona is selected from dropdown', async () => {
    const user = userEvent.setup();
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const addReviewerButton = screen.getByText(/add reviewer/i);
    await user.click(addReviewerButton);

    const personaOption = screen.getByText('Acquisitions Director');
    await user.click(personaOption);

    expect(onAddPersona).toHaveBeenCalledWith('acquisitions_director');
  });

  it('displays persona profile in sidebar', () => {
    render(
      <ScreeningRoom
        project={mockProject}
        reports={[mockReport]}
        availablePersonas={mockAvailablePersonas}
        onAddPersona={onAddPersona}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={onUpdateReportAnswers}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    expect(screen.getByText('Cultural Editor')).toBeInTheDocument();
  });
});

describe('ScreeningRoom Fingerprint Verification', () => {
  it('correctly identifies matching fingerprint', async () => {
    const onVideoReattach = vi.fn();
    
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={[]}
        onAddPersona={vi.fn()}
        onVideoReattach={onVideoReattach}
        onUpdateReportAnswers={vi.fn()}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const matchingFile = new File(['video'], 'test-film.mp4', { type: 'video/mp4' });
    Object.defineProperty(matchingFile, 'size', { value: 100 * 1024 * 1024 });
    Object.defineProperty(matchingFile, 'lastModified', { value: 1234567890 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [matchingFile] } });

    expect(onVideoReattach).toHaveBeenCalled();
    expect(screen.queryByText(/file mismatch/i)).not.toBeInTheDocument();
  });

  it('detects mismatched file name', async () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={[]}
        onAddPersona={vi.fn()}
        onVideoReattach={vi.fn()}
        onUpdateReportAnswers={vi.fn()}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const wrongNameFile = new File(['video'], 'different-name.mp4', { type: 'video/mp4' });
    Object.defineProperty(wrongNameFile, 'size', { value: 100 * 1024 * 1024 });
    Object.defineProperty(wrongNameFile, 'lastModified', { value: 1234567890 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [wrongNameFile] } });

    expect(screen.getByText(/file mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/different-name.mp4/i)).toBeInTheDocument();
  });

  it('detects mismatched file size', async () => {
    render(
      <ScreeningRoom
        project={mockProjectNoVideo}
        reports={[mockReport]}
        availablePersonas={[]}
        onAddPersona={vi.fn()}
        onVideoReattach={vi.fn()}
        onUpdateReportAnswers={vi.fn()}
        isAnalyzing={false}
        analyzingPersonaId={null}
        statusMessage=""
      />
    );

    const wrongSizeFile = new File(['video'], 'test-film.mp4', { type: 'video/mp4' });
    Object.defineProperty(wrongSizeFile, 'size', { value: 500 * 1024 * 1024 });
    Object.defineProperty(wrongSizeFile, 'lastModified', { value: 1234567890 });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [wrongSizeFile] } });

    expect(screen.getByText(/file mismatch/i)).toBeInTheDocument();
  });
});

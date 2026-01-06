import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from '../../components/UploadForm';
import { Project } from '../../types';

describe('UploadForm', () => {
  let onStart: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    onStart = vi.fn();
  });

  it('renders all form fields', () => {
    render(<UploadForm onStart={onStart} />);
    
    expect(screen.getByPlaceholderText(/enter your film title/i)).toBeInTheDocument();
    expect(screen.getByText(/upload film/i)).toBeInTheDocument();
    expect(screen.getByText(/synopsis/i)).toBeInTheDocument();
    expect(screen.getByText(/your questions/i)).toBeInTheDocument();
  });

  it('displays language toggle with English and Traditional Chinese options', () => {
    render(<UploadForm onStart={onStart} />);
    
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('繁體中文')).toBeInTheDocument();
  });

  it('switches language when toggle clicked', async () => {
    const user = userEvent.setup();
    render(<UploadForm onStart={onStart} />);
    
    const zhButton = screen.getByText('繁體中文');
    await user.click(zhButton);
    
    expect(zhButton).toHaveClass('bg-white');
  });

  it('requires title field', () => {
    render(<UploadForm onStart={onStart} />);
    
    const titleInput = screen.getByPlaceholderText(/enter your film title/i);
    expect(titleInput).toBeRequired();
  });

  it('requires video file', () => {
    render(<UploadForm onStart={onStart} />);
    
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeRequired();
  });

  it('accepts video files only', () => {
    render(<UploadForm onStart={onStart} />);
    
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute('accept', 'video/*');
  });

  it('shows file name and size when video is selected', async () => {
    render(<UploadForm onStart={onStart} />);
    
    const file = new File(['video content'], 'test-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [file] } });
    
    expect(screen.getByText(/file selected/i)).toBeInTheDocument();
    expect(screen.getByText(/test-video.mp4/i)).toBeInTheDocument();
  });

  it('renders default research questions', () => {
    render(<UploadForm onStart={onStart} />);
    
    const questions = screen.getAllByPlaceholderText(/what would you like to know/i);
    expect(questions.length).toBeGreaterThan(0);
  });

  it('allows adding a new question', async () => {
    const user = userEvent.setup();
    render(<UploadForm onStart={onStart} />);
    
    const initialQuestions = screen.getAllByPlaceholderText(/what would you like to know/i);
    const addButton = screen.getByText(/\+ add question/i);
    
    await user.click(addButton);
    
    const updatedQuestions = screen.getAllByPlaceholderText(/what would you like to know/i);
    expect(updatedQuestions.length).toBe(initialQuestions.length + 1);
  });

  it('allows removing a question', async () => {
    const user = userEvent.setup();
    render(<UploadForm onStart={onStart} />);
    
    const initialQuestions = screen.getAllByPlaceholderText(/what would you like to know/i);
    const removeButtons = document.querySelectorAll('button[type="button"] svg');
    
    expect(removeButtons.length).toBeGreaterThan(0);
  });

  it('displays persona selector', () => {
    render(<UploadForm onStart={onStart} />);
    
    expect(screen.getByText(/choose reviewer/i)).toBeInTheDocument();
  });

  it('does not call onStart without video file', async () => {
    const user = userEvent.setup();
    render(<UploadForm onStart={onStart} />);
    
    const titleInput = screen.getByPlaceholderText(/enter your film title/i);
    await user.type(titleInput, 'Test Movie');
    
    const submitButton = screen.getByText(/start review/i);
    await user.click(submitButton);
    
    expect(onStart).not.toHaveBeenCalled();
  });

  it('calls onStart with correct project data when form is valid', async () => {
    render(<UploadForm onStart={onStart} />);
    
    const titleInput = screen.getByPlaceholderText(/enter your film title/i);
    await fireEvent.change(titleInput, { target: { value: 'Test Movie' } });
    
    const synopsisInput = screen.getByPlaceholderText(/briefly describe your story/i);
    await fireEvent.change(synopsisInput, { target: { value: 'A test synopsis' } });
    
    const file = new File(['video content'], 'test-video.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
    Object.defineProperty(file, 'lastModified', { value: 1234567890 });
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [file] } });
    
    const form = document.querySelector('form') as HTMLFormElement;
    await fireEvent.submit(form);
    
    expect(onStart).toHaveBeenCalledTimes(1);
    
    const calledProject = onStart.mock.calls[0][0] as Project;
    expect(calledProject.title).toBe('Test Movie');
    expect(calledProject.synopsis).toBe('A test synopsis');
    expect(calledProject.videoFile).toBe(file);
    expect(calledProject.videoFingerprint).toEqual({
      fileName: 'test-video.mp4',
      fileSize: 50 * 1024 * 1024,
      lastModified: 1234567890,
    });
    expect(calledProject.language).toBe('en');
    expect(calledProject.selectedPersonaIds).toHaveLength(1);
  });

  it('captures video fingerprint correctly', async () => {
    render(<UploadForm onStart={onStart} />);
    
    const file = new File(['video content'], 'my-film.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });
    Object.defineProperty(file, 'lastModified', { value: 9876543210 });
    
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await fireEvent.change(fileInput, { target: { files: [file] } });
    
    const titleInput = screen.getByPlaceholderText(/enter your film title/i);
    await fireEvent.change(titleInput, { target: { value: 'My Film' } });
    
    const form = document.querySelector('form') as HTMLFormElement;
    await fireEvent.submit(form);
    
    expect(onStart).toHaveBeenCalledTimes(1);
    const calledProject = onStart.mock.calls[0][0] as Project;
    expect(calledProject.videoFingerprint).toEqual({
      fileName: 'my-film.mp4',
      fileSize: 100 * 1024 * 1024,
      lastModified: 9876543210,
    });
  });
});

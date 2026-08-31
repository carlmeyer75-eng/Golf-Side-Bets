import { useState, useRef, type FormEvent } from 'react';
import {
  Search,
  Upload,
  Plus,
  ArrowLeft,
  Trash2,
  AlertTriangle,
  LoaderCircle,
  MapPin,
  Check,
  Edit2
} from 'lucide-react';
import {
  useListCourses,
  getListCoursesQueryKey,
  useCreateCourse,
  useUpdateCourse,
  useDeleteCourse,
  useImportScorecard,
  useSearchExternalCourses,
  getSearchExternalCoursesQueryKey
} from '@workspace/api-client-react';
import type {
  Course,
  CourseHole,
  CourseImportDraft,
  ExternalCourse
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const DEFAULT_PARS = Array.from({ length: 18 }, () => 4);
const DEFAULT_STROKE_INDEX = Array.from({ length: 18 }, (_, i) => i + 1);

function ErrorState({ onRetry, message = 'Something went wrong.' }: { onRetry: () => void; message?: string }) {
  return (
    <div className="error-state" data-testid="state-error">
      <strong>{message}</strong>
      <p style={{ margin: '7px 0 15px', color: 'inherit', opacity: 0.78, fontSize: 13 }}>
        Please try again.
      </p>
      <button className="button button-danger" onClick={onRetry} data-testid="button-retry">
        Try again
      </button>
    </div>
  );
}

function CourseForm({
  initialData,
  onSave,
  onCancel,
  isDraft = false
}: {
  initialData?: Partial<CourseImportDraft> | Course | ExternalCourse;
  onSave: (data: { name: string; location: string; holes: CourseHole[]; source?: 'manual' | 'upload' | 'external'; sourceDocumentName?: string | null }) => void;
  onCancel: () => void;
  isDraft?: boolean;
}) {
  const [name, setName] = useState(initialData?.name || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [holes, setHoles] = useState<CourseHole[]>(
    initialData?.holes?.length === 18 
      ? initialData.holes 
      : Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 }))
  );
  const [error, setError] = useState('');

  const changeHole = (holeNum: number, field: keyof CourseHole, value: number) => {
    setHoles(current => current.map(h => h.hole === holeNum ? { ...h, [field]: value } : h));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Course name is required.');
      return;
    }
    const parsValid = holes.every(h => Number.isInteger(h.par) && h.par >= 3 && h.par <= 6);
    const strokeIndexValid = holes.every(h => Number.isInteger(h.strokeIndex) && h.strokeIndex >= 1 && h.strokeIndex <= 18);
    const strokeIndexesAreUnique = new Set(holes.map(h => h.strokeIndex)).size === 18;
    if (!parsValid || !strokeIndexValid || !strokeIndexesAreUnique) {
      setError('Pars must be 3-6. Stroke indexes must use every number from 1-18 once.');
      return;
    }
    setError('');
    const source = (initialData as any)?.source;
    const sourceDocumentName = (initialData as any)?.sourceDocumentName;
    onSave({
      name: name.trim(),
      location: location.trim(),
      holes,
      ...(source ? { source } : {}),
      ...(sourceDocumentName ? { sourceDocumentName } : {})
    });
  };

  return (
    <form className="card form-card" style={{ maxWidth: 900 }} onSubmit={submit} data-testid="form-course">
      {isDraft && (initialData as CourseImportDraft)?.warnings?.length ? (
        <div className="error-state" style={{ marginBottom: 20, textAlign: 'left', background: 'hsl(42 85% 51% / 0.1)', borderColor: 'hsl(42 85% 51% / 0.3)', color: 'hsl(42 85% 35%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 700 }}>
            <AlertTriangle size={16} /> Import Warnings
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
            {(initialData as CourseImportDraft).warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field full">
          <label htmlFor="course-name">Course Name</label>
          <input id="course-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pebble Beach" data-testid="input-course-name" />
        </div>
        <div className="field full">
          <label htmlFor="course-location">Location (optional)</label>
          <input id="course-location" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Monterey, CA" data-testid="input-course-location" />
        </div>
        <div className="field full">
          <div className="setup-section">
            <div className="setup-section-heading">
              <div>
                <div className="eyebrow">Hole Details</div>
                <strong>Pars & Stroke Index</strong>
              </div>
            </div>
            <div style={{ overflowX: 'auto', paddingBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, minWidth: 'max-content' }}>
                {holes.map((hole) => (
                  <div key={hole.hole} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 50 }}>
                    <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'hsl(var(--muted-foreground))' }}>{hole.hole}</div>
                    <input 
                      type="number" 
                       min="3" max="6" step="1"
                      value={hole.par} 
                      onChange={e => changeHole(hole.hole, 'par', Number(e.target.value))} 
                      title={`Hole ${hole.hole} Par`} 
                      style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 13, fontWeight: 700, fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} 
                    />
                    <input 
                      type="number" 
                       min="1" max="18" step="1"
                      value={hole.strokeIndex} 
                      onChange={e => changeHole(hole.hole, 'strokeIndex', Number(e.target.value))} 
                      title={`Hole ${hole.hole} Stroke Index`} 
                      style={{ width: '100%', padding: '6px 4px', textAlign: 'center', fontSize: 11, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)', borderRadius: 6, border: '1px solid hsl(var(--border))', background: 'transparent' }} 
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="field-hint" style={{ marginTop: 8 }}>Top row: Par (3-6). Bottom row: Stroke Index (1-18).</div>
          </div>
        </div>
      </div>
      {error && <div className="error-state" style={{ marginTop: 20, padding: 13, textAlign: 'left', fontSize: 13 }}>{error}</div>}
      <div className="form-footer">
        <button type="button" className="button button-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="button button-primary">
          <Check size={15} /> Save course
        </button>
      </div>
    </form>
  );
}

export default function Courses() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const coursesQuery = useListCourses({ search: search || undefined }, { query: { queryKey: getListCoursesQueryKey({ search: search || undefined }) } });
  const deleteCourse = useDeleteCourse();
  const createCourse = useCreateCourse();
  const updateCourse = useUpdateCourse();
  const importScorecard = useImportScorecard();
  
  const [externalSearchQuery, setExternalSearchQuery] = useState('');
  const [enableExternalSearch, setEnableExternalSearch] = useState(false);
  const externalSearch = useSearchExternalCourses(
    { query: externalSearchQuery },
    { query: { enabled: enableExternalSearch && externalSearchQuery.length >= 2, retry: false, queryKey: getSearchExternalCoursesQueryKey({ query: externalSearchQuery }) } }
  );

  const [view, setView] = useState<'list' | 'create' | 'edit' | 'import-review'>('list');
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [draftCourse, setDraftCourse] = useState<CourseImportDraft | (ExternalCourse & { source?: 'external' }) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      alert('File is too large. Maximum size is 6MB.');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result?.toString().split(',')[1];
      if (!base64Data) return;
      
      const mimeType = file.type as any;
      importScorecard.mutate({
        data: {
          fileName: file.name,
          mimeType,
          data: base64Data
        }
      }, {
        onSuccess: (draft) => {
          setDraftCourse(draft);
          setView('import-review');
        },
        onError: () => alert('Failed to parse scorecard.')
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveCreate = (data: any) => {
    createCourse.mutate({ data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setView('list');
      },
      onError: () => alert('Failed to save course.')
    });
  };

  const handleSaveEdit = (data: any) => {
    if (!editingCourse) return;
    updateCourse.mutate({ courseId: editingCourse.id, data }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setView('list');
        setEditingCourse(null);
      },
      onError: () => alert('Failed to update course.')
    });
  };

  const handleDelete = (id: number, name: string) => {
    if (window.confirm(`Delete course "${name}"?`)) {
      deleteCourse.mutate({ courseId: id }, {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        }
      });
    }
  };

  const triggerExternalSearch = (e: FormEvent) => {
    e.preventDefault();
    if (externalSearchQuery.trim().length >= 2) {
      setEnableExternalSearch(true);
      externalSearch.refetch();
    }
  };

  const startEdit = (course: Course) => {
    setEditingCourse(course);
    setView('edit');
  };

  return (
    <main className="content-wrap">
      <div className="topbar">
        <div>
          <div className="eyebrow">Course Library</div>
          <h1 className="display page-title">Your saved layouts.</h1>
          <p className="body-copy" style={{ margin: '11px 0 0', maxWidth: 460 }}>
            Save hole pars and stroke indexes once, reuse them forever.
          </p>
        </div>
        {view !== 'list' ? (
          <div style={{ display: 'flex', gap: 10 }}>
            {view === 'create' && (
              <button className="button button-secondary" onClick={() => fileInputRef.current?.click()} disabled={importScorecard.isPending} data-testid="button-import-scorecard-create">
                {importScorecard.isPending ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
                Import scorecard
              </button>
            )}
            <button className="button button-quiet" onClick={() => setView('list')}>
              <ArrowLeft size={15} /> Back to library
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="button button-secondary" onClick={() => fileInputRef.current?.click()} disabled={importScorecard.isPending}>
              {importScorecard.isPending ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
              Import scorecard
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }} />
            <button className="button button-accent" onClick={() => setView('create')}>
              <Plus size={16} /> New course
            </button>
          </div>
        )}
      </div>

      {view === 'create' && (
        <>
          <div className="card" style={{ padding: 24, marginBottom: 30 }}>
            <h2 className="section-title" style={{ fontSize: 18, marginBottom: 12 }}>Search database</h2>
            <form onSubmit={triggerExternalSearch} style={{ display: 'flex', gap: 10, maxWidth: 500 }}>
              <input 
                className="field" 
                style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid hsl(var(--input))' }} 
                placeholder="Search by course name..." 
                value={externalSearchQuery}
                onChange={e => { setExternalSearchQuery(e.target.value); setEnableExternalSearch(false); }}
              />
              <button type="submit" className="button button-primary" disabled={externalSearch.isFetching}>
                {externalSearch.isFetching ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Search
              </button>
            </form>
            <p className="field-hint" style={{ margin: '10px 0 0' }}>
              Search OpenGolfAPI for courses with a complete 18-hole par and handicap layout. You’ll review every value before saving.
            </p>
            
            {externalSearch.isError && (
              <div className="error-state" style={{ marginTop: 15, padding: 12, textAlign: 'left', fontSize: 13 }}>
                The course directory is currently unavailable. You can still add a course manually or import a scorecard below.
              </div>
            )}
            
            {externalSearch.data && !externalSearch.isFetching && (
              <div style={{ marginTop: 20 }}>
                {!externalSearch.data.available && (
                  <div className="error-state" style={{ padding: 12, textAlign: 'left', fontSize: 13 }}>
                    {externalSearch.data.message || 'Search provider is unavailable.'}
                  </div>
                )}
                {externalSearch.data.courses.length > 0 ? (
                  <div style={{ display: 'grid', gap: 10, marginTop: 15 }}>
                    {externalSearch.data.courses.map(course => (
                      <div key={course.externalId} className="card course-card" style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{course.name}</div>
                          <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}><MapPin size={12} style={{ display: 'inline', marginRight: 4 }}/>{course.location}</div>
                          <div style={{ fontSize: 11, color: 'hsl(var(--primary))', marginTop: 7, fontFamily: 'var(--app-font-mono)' }}>
                            {course.holes.length}/18 holes · par {course.holes.reduce((total, hole) => total + hole.par, 0)} · complete layout
                          </div>
                        </div>
                        <button className="button button-quiet" data-testid={`button-review-external-${course.externalId}`} onClick={() => { setDraftCourse({...course, source: 'external'}); setView('import-review'); }}>
                          <Edit2 size={14} /> Review layout
                        </button>
                      </div>
                    ))}
                  </div>
                ) : externalSearch.data.available && enableExternalSearch ? (
                  <div style={{ marginTop: 15, fontSize: 13, color: 'hsl(var(--muted-foreground))' }}>No courses found matching "{externalSearchQuery}".</div>
                ) : null}
              </div>
            )}
          </div>
          
           <h2 className="section-title" style={{ fontSize: 18, marginBottom: 12 }}>Or add manually</h2>
           <p className="body-copy" style={{ margin: '-3px 0 14px', fontSize: 13 }}>
             Manual entry and scorecard import remain available if a directory result is missing or incomplete.
           </p>
          <CourseForm onSave={handleSaveCreate} onCancel={() => setView('list')} />
        </>
      )}

      {view === 'edit' && editingCourse && (
        <CourseForm initialData={editingCourse} onSave={handleSaveEdit} onCancel={() => setView('list')} />
      )}

      {view === 'import-review' && draftCourse && (
        <CourseForm initialData={draftCourse} onSave={handleSaveCreate} onCancel={() => setView('list')} isDraft={true} />
      )}

      {view === 'list' && (
        <>
          <div style={{ marginBottom: 20, maxWidth: 400 }}>
            <div className="field">
              <input 
                type="text" 
                placeholder="Filter courses..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid hsl(var(--input))' }}
              />
            </div>
          </div>
          
          {coursesQuery.isLoading ? (
            <div className="card" style={{ padding: 40, textAlign: 'center' }}>
              <LoaderCircle className="spin" size={24} style={{ margin: '0 auto', color: 'hsl(var(--muted-foreground))' }} />
            </div>
          ) : coursesQuery.isError ? (
            <ErrorState onRetry={() => coursesQuery.refetch()} />
          ) : coursesQuery.data?.length === 0 ? (
            <div className="empty-state card">
              <div className="empty-mark"><MapPin size={25} /></div>
              <div className="display" style={{ fontSize: 22 }}>No courses found.</div>
              <p className="body-copy">Search the database or add one manually.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 15 }}>
              {coursesQuery.data?.map(course => (
                <div key={course.id} className="card course-card" style={{ padding: 20, display: 'flex', flexDirection: 'column' }} onClick={() => startEdit(course)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{course.name}</div>
                      {course.location && <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{course.location}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button className="button button-ghost" onClick={(e) => { e.stopPropagation(); handleDelete(course.id, course.name); }} style={{ padding: 6, color: 'hsl(var(--destructive))' }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  
                  <div style={{ marginTop: 'auto', paddingTop: 15, borderTop: '1px solid hsl(var(--border))', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                    <span>{course.holes.length} holes</span>
                    <span style={{ textTransform: 'capitalize' }}>Source: {course.source}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

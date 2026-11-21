/**
 * Feature registration. Each import registers its tab views, page bodies, panels and commands as a side effect.
 * Later milestones append their modules here.
 */
import '@/layout/layoutCommands';
import '@/panels/PageInfoPanel';
import '@/views/PageTabView';
import '@/views/SearchView';
import '@/views/TrashView';
import '@/views/SettingsView';
import '@/editor/register';
import '@/history/register';
import '@/canvas/register';
import '@/pdf/register';
import '@/paint/register';

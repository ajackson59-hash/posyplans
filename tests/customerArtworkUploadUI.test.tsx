import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomerArtworkView } from '@shared/customerArtwork';
import CustomerArtworkPreview from '@/components/CustomerArtworkPreview';
const mocks=vi.hoisted(()=>({request:vi.fn(),read:vi.fn()}));
vi.mock('@/lib/queryClient',()=>({apiRequestJson:mocks.request}));
vi.mock('@/lib/imageUpload',()=>({readCustomerArtworkFile:mocks.read}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const failed:CustomerArtworkView={version:2,briefHash:'a'.repeat(64),savedBrief:'Exact original scene request',generationEnabled:false,requestsRemaining:0,state:'failed',selectedId:null,selectedHash:null,appliedId:null,hasSavedPlan:false,canContinue:false,supportReference:'failure-reference',candidates:[],uploadAvailable:true,uploadsRemaining:3};
const uploaded:CustomerArtworkView={...failed,version:3,uploadsRemaining:2,candidates:[{id:'upload-id',imageHash:'b'.repeat(64),assetUrl:'/private/upload.png',operation:'upload',correction:null}]};
describe('artwork upload recovery controls',()=>{
 it('explains a generation hold without inviting an unavailable creation or claiming unused quota is exhausted',()=>{
  const client=new QueryClient();render(<QueryClientProvider client={client}><CustomerArtworkPreview ownerToken="synthetic-owner" artwork={{...failed,state:'empty',supportReference:null}} refresh={vi.fn()} /></QueryClientProvider>);
  expect(screen.getByText('Your request is saved. Choose a ready-made design or upload artwork to continue.')).toBeTruthy();
  expect(screen.queryByText(/Enter your email below to create your preview/)).toBeNull();
  expect(screen.queryByText(/reached this event’s artwork limit/)).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();client.clear();
 });
 it('offers recovery without a nonexistent image, uploads once, and requires a loaded image plus explicit keep',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  mocks.read.mockResolvedValue('data:image/jpeg;base64,synthetic');mocks.request.mockResolvedValue(uploaded);
  const draw=(view:CustomerArtworkView)=><QueryClientProvider client={client}><CustomerArtworkPreview ownerToken="synthetic-owner" artwork={view} refresh={vi.fn()} /></QueryClientProvider>;
  const ui=render(draw(failed));
  expect(screen.queryByText('Keep the image you love, or tell Posy what to change.')).toBeNull();
  expect(screen.getByText('Or use my own artwork')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Choose artwork'),{target:{files:[new File(['image'],'mine.png',{type:'image/png'})]}});
  await waitFor(()=>expect(mocks.request).toHaveBeenCalledTimes(1));
  expect(mocks.request.mock.calls[0][1]).toBe('/api/events/owner/synthetic-owner/artwork/upload');
  await waitFor(()=>expect(screen.getByText(/Your artwork is saved/)).toBeTruthy());
  ui.rerender(draw(uploaded));
  expect((screen.getByRole('button',{name:'Keep this image'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.load(screen.getByTestId('customer-artwork-image'));
  fireEvent.click(screen.getByRole('button',{name:'Keep this image'}));
  await waitFor(()=>expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(mocks.request.mock.calls[1][1]).toBe('/api/events/owner/synthetic-owner/artwork/select');
  expect(mocks.request.mock.calls.some(([,url])=>/revise|prepayment-preview$/.test(url))).toBe(false);
  expect(screen.queryByRole('button',{name:'Make this change'})).toBeNull();client.clear();
 });
 it('rejects unreadable files before any server request',async()=>{
  mocks.read.mockRejectedValue(new Error('Choose a clearer image.'));
  const client=new QueryClient();render(<QueryClientProvider client={client}><CustomerArtworkPreview ownerToken="synthetic-owner" artwork={failed} refresh={vi.fn()} /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Choose artwork'),{target:{files:[new File(['bad'],'bad.png',{type:'image/png'})]}});
  await screen.findByText('Choose a clearer image.');expect(mocks.request).not.toHaveBeenCalled();client.clear();
 });
});

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="mt-2 text-gray-600">Deze pagina bestaat niet.</p>
        <a href="/" className="mt-4 inline-block text-blue-600 hover:underline">
          ← Naar start
        </a>
      </div>
    </main>
  );
}

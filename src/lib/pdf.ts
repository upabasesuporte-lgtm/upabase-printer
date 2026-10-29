// Gerador de PDF (jsPDF) carregado só quando precisa — não pesa no sistema.
let jsPdfLoad: Promise<any> | null = null;

export function loadJsPdf(): Promise<any> {
  const w = window as any;
  if (w.jspdf?.jsPDF) return Promise.resolve(w.jspdf.jsPDF);
  jsPdfLoad ??= new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    sc.onload = () => (w.jspdf?.jsPDF ? resolve(w.jspdf.jsPDF) : reject(new Error("PDF indisponível")));
    sc.onerror = () => { jsPdfLoad = null; sc.remove(); reject(new Error("Sem internet para gerar o PDF")); };
    document.head.appendChild(sc);
  });
  return jsPdfLoad;
}

// Baixa o PDF; no celular abre a tela de compartilhar
export async function savePdf(doc: any, fileName: string): Promise<void> {
  const file = new File([doc.output("blob")], fileName, { type: "application/pdf" });
  const nav = navigator as any;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: fileName }).catch(() => {});
  } else {
    doc.save(fileName);
  }
}

import * as Electron from 'electron';
import * as Puppeteer from 'puppeteer';
import * as PDFLibrary from 'pdf-lib';

import fs from 'fs/promises';
import child_process from 'child_process';

class Doxer {
  private importedFilePaths = new Array<string>();
  private pdfBytesArray = new Array<Uint8Array>();

  private unifiedPDFBytes: Uint8Array;

  public async startApplication(): Promise<void> {
    await Electron.app.whenReady();
  }

  public async importPDFandSVGFiles(): Promise<void> {
    const openDialogResult = await Electron.dialog.showOpenDialog({
      filters: [
        {name: 'PDF and SVG files', extensions: ['pdf', 'svg']},
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (!openDialogResult.canceled) {
      this.importedFilePaths = openDialogResult.filePaths;
    } else {
      this.endApplication();
    }
  }

  public async unifyImportedFiles(): Promise<void> {
    for (var importedFilePath of this.importedFilePaths) {
      if (importedFilePath.endsWith('.pdf')) {
        const importedFileBuffer = await fs.readFile(importedFilePath);
        const importedFileBytes = new Uint8Array(importedFileBuffer);

        this.pdfBytesArray.push(importedFileBytes);
      }

      if (importedFilePath.endsWith('.svg')) {
        const convertedFileBytes = await Utils.convertSVGtoPDF(importedFilePath);

        this.pdfBytesArray.push(convertedFileBytes);
      }
    }

    const combinedPDFBytes = await Utils.combinePDFsIntoOne(this.pdfBytesArray);
    const normalizedPDFBytes = await Utils.normalizePDFDimensions(combinedPDFBytes);

    this.unifiedPDFBytes = normalizedPDFBytes;
  }

  public async saveUnifiedFile(): Promise<void> {
    const saveDialogResult = await Electron.dialog.showSaveDialog({
      defaultPath: 'output.pdf'
    })
    
    if (!saveDialogResult.canceled) {
      const fileBuffer = Buffer.from(this.unifiedPDFBytes);
      await fs.writeFile(saveDialogResult.filePath, fileBuffer);
    } else {
      this.endApplication();
    }
  }

  public endApplication(): void {
    Electron.app.exit(0);
  }
}

class Utils {
  public static async convertSVGtoPDF(svgFilePath: string): Promise<Uint8Array> {
    const svgFileContent = await fs.readFile(svgFilePath, 'utf8');

    const virtualBrowser = await Puppeteer.launch({
      headless: 'new'
    });

    const browserPage = await virtualBrowser.newPage();
    await browserPage.setContent(svgFileContent);

    const svgElement = await browserPage.$('svg');
    const svgBoundingBox = await svgElement?.boundingBox();

    const svgWidth = Number(svgBoundingBox?.width);
    const svgHeight = Number(svgBoundingBox?.height);

    const pdfBuffer = await browserPage.pdf({
      width: svgWidth + 'px',
      height: svgHeight + 'px',
      printBackground: true
    });

    await virtualBrowser.close();

    const pdfDocument = await PDFLibrary.PDFDocument.load(pdfBuffer);
    const pdfDocumentPageCount = pdfDocument.getPageCount();

    for (let pageIndex = 0; pageIndex < pdfDocumentPageCount - 1; pageIndex++) {
      pdfDocument.removePage(pageIndex);
    }

    const pdfBytes = await pdfDocument.save();

    return pdfBytes;
  }

  public static async combinePDFsIntoOne(pdfBytesArray: Uint8Array[]): Promise<Uint8Array> {
    const combinedPDFDocument = await PDFLibrary.PDFDocument.create();
 
    for (let pdfCount = 0; pdfCount < pdfBytesArray.length; pdfCount++) {
      const detachedPDFDocument = await PDFLibrary.PDFDocument.load(pdfBytesArray[pdfCount]);
      const pageIndicies = detachedPDFDocument.getPageIndices();

      const newPages = await combinedPDFDocument.copyPages(detachedPDFDocument, pageIndicies)
      newPages.forEach((newPage) => combinedPDFDocument.addPage(newPage));
    }

    const combinedPDFBytes = await combinedPDFDocument.save();

    return combinedPDFBytes;
  }

  public static async normalizePDFDimensions(pdfBytes: Uint8Array): Promise<Uint8Array> {
    const A4_PAPER_WIDTH_IN_POINTS = 595.2764;

    const irregularPDFDocument = await PDFLibrary.PDFDocument.load(pdfBytes);
    const irregularPDFPages = irregularPDFDocument.getPages();

    irregularPDFPages.forEach((pdfPage) => {
      const pageSize = pdfPage.getSize();
      const scaleFactor = A4_PAPER_WIDTH_IN_POINTS / pageSize.width;

      pdfPage.scale(scaleFactor, scaleFactor);
      pdfPage.setSize(pageSize.width * scaleFactor, pageSize.height * scaleFactor);
    });

    const normalizedPDFBytes = await irregularPDFDocument.save();

    return normalizedPDFBytes;
  }
}

async function main(): Promise<void> {
  const doxer = new Doxer();

  await doxer.startApplication();
  await doxer.importPDFandSVGFiles();
  await doxer.unifyImportedFiles();
  await doxer.saveUnifiedFile();

  doxer.endApplication();
}

if (!process.argv[0].includes('electron')) {
  child_process.spawnSync('./node_modules/.bin/electron', ['.']);
}

else {
  main();
}
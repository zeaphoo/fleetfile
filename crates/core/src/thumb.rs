use std::io::Cursor;

use crate::CoreError;

/// Generate a square PNG thumbnail for an image file, preserving aspect ratio
/// (thumbnail fits inside `size`x`size`). Returns encoded PNG bytes.
pub fn make_thumbnail(path: &str, size: u32) -> Result<Vec<u8>, CoreError> {
    let size = size.clamp(32, 512);
    let reader = image::io::Reader::open(path).map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    let reader = reader
        .with_guessed_format()
        .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())))?;
    // Guard against pathological image dimensions before decoding.
    let dims = reader.into_dimensions().map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    if dims.0.saturating_mul(dims.1) > 40_000_000 {
        return Err(CoreError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "image too large to thumbnail",
        )));
    }
    // Re-open for decoding (into_dimensions consumed the reader).
    let reader = image::io::Reader::open(path).map_err(|e| {
        CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))
    })?;
    let reader = reader
        .with_guessed_format()
        .map_err(|e| CoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())))?;
    let img = reader.decode()?;
    let thumb = img.thumbnail(size, size);
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut cursor = Cursor::new(&mut buf);
        thumb.write_to(&mut cursor, image::ImageFormat::Png)?;
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnails_a_png() {
        // 1x1 red PNG
        let img = image::RgbaImage::from_pixel(4, 4, image::Rgba([255u8, 0, 0, 255]));
        let dir = std::env::temp_dir().join(format!("fleetfile_thumb_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("dot.png");
        img.save(&p).unwrap();
        let bytes = make_thumbnail(p.to_str().unwrap(), 64).unwrap();
        assert!(!bytes.is_empty());
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.width(), 64); // thumbnail normalizes to the target box
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
